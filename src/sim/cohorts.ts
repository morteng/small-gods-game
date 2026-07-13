/**
 * cohorts.ts — the statistical population tier's data model (two-tier population
 * epic, P0). A `SettlementCohorts` record per settlement carries age-band cohorts
 * with integer counts and per-spirit RUNNING BELIEF SUMS (not means — exact under
 * add/remove, so materialization in later slices never drifts the aggregate).
 *
 * P0 is SHADOW BOOKKEEPING: cohorts are censused from the living named population
 * and verified against lifecycle flows (CohortSystem) with zero gameplay reads.
 * ALL cohort mutation flows through this module — the single choke point the
 * conservation ledger audits.
 */

import type { World } from '@/world/world';
import type { EntityId, NpcNeeds, SpiritBelief } from '@/core/types';
import type { SpiritId } from '@/core/spirit';
import { queryNpcs, npcProps } from '@/world/npc-helpers';
import { ageInYears, ADULT_AGE, SENESCENCE_START, MAX_AGE } from '@/sim/mortality';
import { FERTILE_MIN_AGE, FERTILE_MAX_AGE } from '@/sim/systems/birth-system';
import { POWER_UNDERSTANDING_COEFF, POWER_DEVOTION_COEFF } from '@/sim/spirit-system';
import { BELIEVER_THRESHOLD, isDurable } from '@/sim/believers';

/** Bucket for living NPCs with no `homePoiId` — every soul must sit in exactly
 *  one bucket or per-settlement conservation can't balance globally. */
export const UNHOMED_COHORT_ID = '(unhomed)';

/** Upper senescence split (spec §3.1) — the one band edge that is not a shipped
 *  lifecycle constant; it halves the SENESCENCE_START→MAX_AGE mortality ramp so
 *  `annualMortality` stays roughly monotone-linear within each band. */
const SENESCENCE_SPLIT_AGE = 75;

/** Band edges in years, aligned with the shipped lifecycle constants so every
 *  rate the live systems use is constant or monotone within a band:
 *  0–15 child (ADULT_AGE) · 15–18 · 18–45 fertile (FERTILE_MIN/MAX_AGE) ·
 *  45–55 · 55–75 (SENESCENCE_START) · 75–95 (MAX_AGE). */
export const COHORT_BAND_EDGES: readonly number[] = [
  0, ADULT_AGE, FERTILE_MIN_AGE, FERTILE_MAX_AGE, SENESCENCE_START, SENESCENCE_SPLIT_AGE, MAX_AGE,
];
export const COHORT_BAND_COUNT = COHORT_BAND_EDGES.length - 1;

export interface CohortBelief {
  sumFaith: number;
  /** Σ understanding. */
  sumU: number;
  /** Σ devotion. */
  sumD: number;
  /** Σ faith·(1+2u)·(1+2d) — the exact power-contribution sum, maintained with
   *  the identical formula SpiritSystem's named loop uses. */
  sumContribution: number;
  /** Souls with faith ≥ BELIEVER_THRESHOLD. */
  believerCount: number;
  /** Souls passing isDurable (believers.ts). */
  durableCount: number;
}

export interface CohortBand {
  /** [minAge, maxAge) in years. The LAST band is open-ended in classification —
   *  a soul can outlive MAX_AGE by up to one mortality check. */
  ageMin: number;
  ageMax: number;
  /** Integer souls. */
  count: number;
  /** Fractional-age accumulator for statistical aging (spec §3.3). Inert in P0:
   *  shadow bands are re-censused, so aging is observed, not integrated. */
  agingFrac: number;
  /** Per-spirit RUNNING SUMS (not means) — exact under add/remove. */
  belief: Record<SpiritId, CohortBelief>;
  /** Need MEANS over the band's souls. */
  needs: NpcNeeds;
}

export interface SettlementCohorts {
  poiId: string;
  /** Fixed band edges, index-stable (COHORT_BAND_EDGES). */
  bands: CohortBand[];
  /** Monotonic per-settlement draw counter — the materialization determinism
   *  anchor (spec §4.2). Inert in P0 (nothing materializes). */
  drawCount: number;
  /** Settlement-level plea ledger per spirit (spec §5.3). Inert in P0. */
  pleas: Record<SpiritId, { count: number; oldestSince: number }>;
}

/** One observed soul — the unit `addSoul`/`removeSoul` transfer. */
export interface SoulObservation {
  age: number;
  beliefs: Record<SpiritId, SpiritBelief>;
  needs: NpcNeeds;
}

/** Band index for an age in years. Ages past the last edge stay in the last
 *  band (see CohortBand.ageMax note); negative ages clamp to band 0. */
export function bandIndexForAge(age: number): number {
  for (let i = 1; i < COHORT_BAND_EDGES.length - 1; i++) {
    if (age < COHORT_BAND_EDGES[i]) return i - 1;
  }
  return COHORT_BAND_COUNT - 1;
}

function emptyBelief(): CohortBelief {
  return { sumFaith: 0, sumU: 0, sumD: 0, sumContribution: 0, believerCount: 0, durableCount: 0 };
}

export function emptySettlementCohorts(poiId: string): SettlementCohorts {
  const bands: CohortBand[] = [];
  for (let i = 0; i < COHORT_BAND_COUNT; i++) {
    bands.push({
      ageMin: COHORT_BAND_EDGES[i],
      ageMax: COHORT_BAND_EDGES[i + 1],
      count: 0,
      agingFrac: 0,
      belief: {},
      needs: { safety: 0, prosperity: 0, community: 0, meaning: 0 },
    });
  }
  return { poiId, bands, drawCount: 0, pleas: {} };
}

/** The exact power contribution SpiritSystem accumulates per believer. */
export function beliefContribution(b: SpiritBelief): number {
  return b.faith
    * (1 + POWER_UNDERSTANDING_COEFF * b.understanding)
    * (1 + POWER_DEVOTION_COEFF * b.devotion);
}

/** Add one soul's exact contributions to its age band. Belief sums are exact;
 *  need means use the incremental-mean update. */
export function addSoul(sc: SettlementCohorts, soul: SoulObservation): void {
  const band = sc.bands[bandIndexForAge(soul.age)];
  const n = band.count + 1;
  band.needs.safety     += (soul.needs.safety     - band.needs.safety)     / n;
  band.needs.prosperity += (soul.needs.prosperity - band.needs.prosperity) / n;
  band.needs.community  += (soul.needs.community  - band.needs.community)  / n;
  band.needs.meaning    += (soul.needs.meaning    - band.needs.meaning)    / n;
  band.count = n;
  for (const [sid, b] of Object.entries(soul.beliefs)) {
    const agg = (band.belief[sid] ??= emptyBelief());
    agg.sumFaith += b.faith;
    agg.sumU += b.understanding;
    agg.sumD += b.devotion;
    agg.sumContribution += beliefContribution(b);
    if (b.faith >= BELIEVER_THRESHOLD) agg.believerCount++;
    if (isDurable(b)) agg.durableCount++;
  }
}

/** Remove one soul's exact contributions from its age band — the inverse of
 *  `addSoul` for the same observation (running sums stay consistent with the
 *  souls actually remaining, spec §3.2). */
export function removeSoul(sc: SettlementCohorts, soul: SoulObservation): void {
  const band = sc.bands[bandIndexForAge(soul.age)];
  const n = band.count - 1;
  if (n <= 0) {
    band.needs = { safety: 0, prosperity: 0, community: 0, meaning: 0 };
  } else {
    band.needs.safety     = (band.needs.safety     * band.count - soul.needs.safety)     / n;
    band.needs.prosperity = (band.needs.prosperity * band.count - soul.needs.prosperity) / n;
    band.needs.community  = (band.needs.community  * band.count - soul.needs.community)  / n;
    band.needs.meaning    = (band.needs.meaning    * band.count - soul.needs.meaning)    / n;
  }
  band.count = Math.max(0, n);
  for (const [sid, b] of Object.entries(soul.beliefs)) {
    const agg = band.belief[sid];
    if (!agg) continue;
    agg.sumFaith -= b.faith;
    agg.sumU -= b.understanding;
    agg.sumD -= b.devotion;
    agg.sumContribution -= beliefContribution(b);
    if (b.faith >= BELIEVER_THRESHOLD) agg.believerCount--;
    if (isDurable(b)) agg.durableCount--;
  }
}

/** Total souls across a settlement's bands. */
export function cohortPopulation(sc: SettlementCohorts): number {
  let n = 0;
  for (const band of sc.bands) n += band.count;
  return n;
}

export interface CohortCensus {
  /** Per-bucket cohorts, keyed by homePoiId (or UNHOMED_COHORT_ID). */
  cohorts: Map<string, SettlementCohorts>;
  /** Living named soul → bucket, the structural-diff basis for the ledger. */
  homes: Map<EntityId, string>;
}

/**
 * Census the living named population into cohorts. Souls are folded in sorted
 * entity-id order so the float sums are independent of World insertion order
 * (a snapshot restore re-adds entities in a different order — sums must still
 * reproduce byte-identically for the determinism/replay guarantee).
 */
export function censusCohorts(world: World, now: number): CohortCensus {
  const cohorts = new Map<string, SettlementCohorts>();
  const homes = new Map<EntityId, string>();
  const living = queryNpcs(world)
    .slice()
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const e of living) {
    const p = npcProps(e);
    const poiId = p.homePoiId ?? UNHOMED_COHORT_ID;
    let sc = cohorts.get(poiId);
    if (!sc) cohorts.set(poiId, (sc = emptySettlementCohorts(poiId)));
    addSoul(sc, { age: ageInYears(p.birthTick, now), beliefs: p.beliefs, needs: p.needs });
    homes.set(e.id, poiId);
  }
  return { cohorts, homes };
}
