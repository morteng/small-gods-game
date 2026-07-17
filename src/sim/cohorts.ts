/**
 * cohorts.ts — the statistical population tier's data model (two-tier population
 * epic, P0+P1). A `SettlementCohorts` record per settlement carries age-band
 * cohorts with integer counts and per-spirit RUNNING BELIEF SUMS (not means —
 * exact under add/remove, so materialization in later slices never drifts the
 * aggregate).
 *
 * P0 shipped SHADOW BOOKKEEPING: cohorts censused from the living named
 * population and verified against lifecycle flows (CohortSystem).
 *
 * P1 adds the LIVE STATISTICAL TIER — souls beyond the named residents, seeded
 * at worldgen (`seedStatisticalCohorts`, stored on `GameState.cohorts`,
 * snapshot-captured) and READ by the belief economy: SpiritSystem power regen,
 * believer counts, `buildRivalSituation`, tile realization (PerceptionSystem —
 * user ruling 2026-07-13: aggregate cohort belief realizes tiles too), and the
 * settlement growth / birth throttle. Statistical souls are DISJOINT from named
 * ones by construction: the named tier lives only in World entities (and the
 * P0 shadow census); the statistical tier holds `fictionTarget − named` extra
 * souls — no soul is ever counted in both.
 *
 * Deliberately NOT in P1 (P2 territory, spec §4/§5.3): materialization /
 * fold-back (the transfer fns `addSoul`/`removeSoul` are the ready seam),
 * statistical demographic flows (births/deaths/aging/migration — the tier's
 * counts are CONSTANT in P1 and CohortSystem audits exactly that), statistical
 * belief drift, and the settlement plea ledger + statistical rival claims.
 *
 * ALL cohort mutation flows through this module — the single choke point the
 * conservation ledger audits.
 */

import type { World } from '@/world/world';
import type { EntityId, NpcNeeds, SpiritBelief, WorldSeed, POI } from '@/core/types';
import type { Spirit, SpiritId } from '@/core/spirit';
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

/** The statistical tier's untithed prosperity equilibrium — the value
 *  `seedStatisticalCohorts` seeds every occupied band with. */
export const STAT_UNTITHED_PROSPERITY = 0.5;

/**
 * M3 / M0.c — the lord's tithe pressed onto the STATISTICAL tier (the spec's
 * cohort double-accounting warning: every lord effect must hit both tiers).
 * The named tier feels the tithe as a scaled `work` self-restore; the mirror
 * here relaxes each occupied band's prosperity MEAN toward the same tithed
 * equilibrium, `STAT_UNTITHED_PROSPERITY × (1 − tithe)`, by `alpha` per call.
 * Relaxation (not a raw drain) so the tier recovers when the tithe is eased —
 * and a tithe of 0 holds the band at its seeded level. Deterministic, no rng;
 * counts are untouched (the P1 conservation audit is over counts).
 */
export function applyCohortTithe(sc: SettlementCohorts, tithe: number, alpha: number): void {
  const t = Math.max(0, Math.min(1, tithe));
  const target = STAT_UNTITHED_PROSPERITY * (1 - t);
  for (const band of sc.bands) {
    if (band.count <= 0) continue;
    band.needs.prosperity += (target - band.needs.prosperity) * alpha;
  }
}

/** Total souls across a settlement's bands. */
export function cohortPopulation(sc: SettlementCohorts): number {
  let n = 0;
  for (const band of sc.bands) n += band.count;
  return n;
}

/** Population-weighted mean prosperity 0..1 across a settlement's bands (the "purse" the road-wear
 *  economy reads for its wealth term). An empty settlement has no purse — returns 0. */
export function cohortMeanProsperity(sc: SettlementCohorts): number {
  let sum = 0, pop = 0;
  for (const band of sc.bands) {
    if (band.count <= 0) continue;
    sum += band.needs.prosperity * band.count;
    pop += band.count;
  }
  return pop > 0 ? sum / pop : 0;
}

export interface CohortCensus {
  /** Per-bucket cohorts, keyed by homePoiId (or UNHOMED_COHORT_ID). */
  cohorts: Map<string, SettlementCohorts>;
  /** Living named soul → bucket, the structural-diff basis for the ledger. */
  homes: Map<EntityId, string>;
}

/** Believers toward one spirit across a settlement's bands. */
export function cohortBelievers(sc: SettlementCohorts, spiritId: SpiritId): number {
  let n = 0;
  for (const band of sc.bands) n += band.belief[spiritId]?.believerCount ?? 0;
  return n;
}

/** Durable believers toward one spirit across a settlement's bands. */
export function cohortDurables(sc: SettlementCohorts, spiritId: SpiritId): number {
  let n = 0;
  for (const band of sc.bands) n += band.belief[spiritId]?.durableCount ?? 0;
  return n;
}

/**
 * Per-spirit power-contribution totals across every settlement's statistical
 * bands — the exact term SpiritSystem adds to its named per-believer scan.
 * Folds in sorted poiId order (and sorted spirit-id order within a band) so
 * the float sums are replay-stable regardless of Map insertion order.
 */
export function cohortContributionTotals(
  cohorts: ReadonlyMap<string, SettlementCohorts>,
): Map<SpiritId, number> {
  const totals = new Map<SpiritId, number>();
  for (const poiId of [...cohorts.keys()].sort()) {
    for (const band of cohorts.get(poiId)!.bands) {
      for (const sid of Object.keys(band.belief).sort()) {
        const c = band.belief[sid].sumContribution;
        if (c !== 0) totals.set(sid, (totals.get(sid) ?? 0) + c);
      }
    }
  }
  return totals;
}

/** Believers toward one spirit summed over every settlement (sorted fold). */
export function totalCohortBelievers(
  cohorts: ReadonlyMap<string, SettlementCohorts>, spiritId: SpiritId,
): number {
  let n = 0;
  for (const poiId of [...cohorts.keys()].sort()) n += cohortBelievers(cohorts.get(poiId)!, spiritId);
  return n;
}

/** Durable believers toward one spirit summed over every settlement. */
export function totalCohortDurables(
  cohorts: ReadonlyMap<string, SettlementCohorts>, spiritId: SpiritId,
): number {
  let n = 0;
  for (const poiId of [...cohorts.keys()].sort()) n += cohortDurables(cohorts.get(poiId)!, spiritId);
  return n;
}

/** The settlement's DOMINANT statistical belief (by total faith mass, spirit-id
 *  tiebreak), with population means — what tile realization reads (ruling 2). */
export interface CohortBeliefStats {
  spiritId: SpiritId;
  believerCount: number;
  /** Mean over ALL souls in the settlement (believers dilute into the crowd). */
  meanFaith: number;
  meanUnderstanding: number;
}

export function dominantCohortBelief(sc: SettlementCohorts): CohortBeliefStats | null {
  const pop = cohortPopulation(sc);
  if (pop <= 0) return null;
  const acc = new Map<SpiritId, { faith: number; u: number; believers: number }>();
  for (const band of sc.bands) {
    for (const sid of Object.keys(band.belief).sort()) {
      const b = band.belief[sid];
      const a = acc.get(sid) ?? { faith: 0, u: 0, believers: 0 };
      a.faith += b.sumFaith; a.u += b.sumU; a.believers += b.believerCount;
      acc.set(sid, a);
    }
  }
  let best: SpiritId | null = null;
  for (const sid of [...acc.keys()].sort()) {
    if (best === null || acc.get(sid)!.faith > acc.get(best)!.faith) best = sid;
  }
  if (best === null) return null;
  const a = acc.get(best)!;
  if (a.believers <= 0) return null;
  return {
    spiritId: best,
    believerCount: a.believers,
    meanFaith: a.faith / pop,
    meanUnderstanding: a.u / pop,
  };
}

// ── P1 worldgen seeding — the fiction population beyond the named residents ──

/** Worldgen-authored fiction population per settlement, by POI `size` (spec P1:
 *  ~5–10× the named-resident scale). The STATISTICAL tier holds the difference
 *  between this target and the named residents actually living there. */
export const FICTION_POP_BY_SIZE: Record<NonNullable<POI['size']>, number> = {
  small: 36, medium: 72, large: 144, huge: 288,
};

/** Age-pyramid weights over the six bands (0–15 · 15–18 · 18–45 · 45–55 ·
 *  55–75 · 75–95) — a broad-based medieval pyramid. */
export const STAT_BAND_WEIGHTS: readonly number[] = [0.32, 0.06, 0.40, 0.10, 0.09, 0.03];

/** Fraction of a settlement's statistical souls seeded as shallow believers in
 *  its locally dominant spirit. Conservative: most statistical souls start
 *  heathen; conversion at scale is what the belief loops are FOR. */
export const STAT_BELIEVER_FRAC = 0.25;

/** Seeded statistical believers start at the founders' shallow-believer line
 *  (just above BELIEVER_THRESHOLD, zero understanding/devotion — seed-world's
 *  cradle convention). */
export const STAT_SEED_FAITH = 0.18;

/**
 * Deterministic largest-remainder apportionment of `total` integer souls over
 * `weights` (ties broken by lower index). Zero-weight slots never receive.
 */
export function apportion(total: number, weights: readonly number[]): number[] {
  const out = weights.map(() => 0);
  const sum = weights.reduce((a, b) => a + b, 0);
  if (total <= 0 || sum <= 0) return out;
  const quotas = weights.map(w => (total * w) / sum);
  let assigned = 0;
  quotas.forEach((q, i) => { out[i] = Math.floor(q); assigned += out[i]; });
  const remainders = quotas
    .map((q, i) => ({ i, r: q - Math.floor(q) }))
    .sort((a, b) => (b.r - a.r) || (a.i - b.i));
  for (let k = 0; assigned < total && k < remainders.length; k++, assigned++) {
    out[remainders[k].i]++;
  }
  return out;
}

/** The spirit a settlement's statistical souls lean toward at seed time: the
 *  spirit with the most NAMED believers living there (the cradle's founders
 *  make it the player's), else the id-sorted first rival that holds it, else
 *  none (a heathen settlement). */
function dominantSpiritForPoi(
  poiId: string,
  namedSc: SettlementCohorts | undefined,
  spirits: Map<SpiritId, Spirit>,
): SpiritId | null {
  if (namedSc) {
    const totals = new Map<SpiritId, number>();
    for (const band of namedSc.bands) {
      for (const sid of Object.keys(band.belief).sort()) {
        totals.set(sid, (totals.get(sid) ?? 0) + band.belief[sid].believerCount);
      }
    }
    let best: SpiritId | null = null;
    let bestN = 0;
    for (const sid of [...totals.keys()].sort()) {
      const n = totals.get(sid)!;
      if (n > bestN) { best = sid; bestN = n; }
    }
    if (best !== null) return best;
  }
  for (const sid of [...spirits.keys()].sort()) {
    const s = spirits.get(sid)!;
    if (!s.isPlayer && (s.ai?.settlements ?? []).includes(poiId)) return sid;
  }
  return null;
}

/**
 * Seed the STATISTICAL population tier at worldgen (P1). For every inhabited
 * settlement POI (authored `npcs` — the same filter rival instantiation uses),
 * the fiction target (`FICTION_POP_BY_SIZE`) minus the named residents becomes
 * statistical souls spread over an age pyramid; a conservative believer
 * fraction leans toward the settlement's locally dominant spirit at the
 * founders' shallow-believer faith. Fully deterministic — expected-value
 * apportionment only, NO rng draws (nothing to perturb, nothing to replay).
 *
 * Conservation: this runs ONCE per world (worldgen, before the first sim tick)
 * and is the statistical tier's only source; CohortSystem thereafter audits
 * that the tier's counts never change (P1 has no statistical flows).
 */
export function seedStatisticalCohorts(
  world: World,
  worldSeed: WorldSeed,
  spirits: Map<SpiritId, Spirit>,
  now: number,
): Map<string, SettlementCohorts> {
  const { cohorts: named } = censusCohorts(world, now);
  const out = new Map<string, SettlementCohorts>();
  const inhabited = (worldSeed.pois ?? [])
    .filter(p => (p.npcs?.length ?? 0) > 0)
    .slice()
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const poi of inhabited) {
    const target = FICTION_POP_BY_SIZE[poi.size ?? 'small'] ?? FICTION_POP_BY_SIZE.small;
    const namedSc = named.get(poi.id);
    const namedPop = namedSc ? cohortPopulation(namedSc) : 0;
    // DISJOINT BY CONSTRUCTION: statistical souls are only the EXTRA fiction
    // population — a named soul is never mirrored into the statistical tier.
    const statPop = Math.max(0, target - namedPop);
    const sc = emptySettlementCohorts(poi.id);
    if (statPop > 0) {
      const perBand = apportion(statPop, STAT_BAND_WEIGHTS);
      perBand.forEach((n, i) => {
        sc.bands[i].count = n;
        if (n > 0) sc.bands[i].needs = { safety: 0.5, prosperity: 0.5, community: 0.5, meaning: 0.5 };
      });
      const sid = dominantSpiritForPoi(poi.id, namedSc, spirits);
      if (sid !== null) {
        const adultCounts = sc.bands.map(b => (b.ageMin >= ADULT_AGE ? b.count : 0));
        const adultTotal = adultCounts.reduce((a, b) => a + b, 0);
        const believers = Math.min(adultTotal, Math.round(statPop * STAT_BELIEVER_FRAC));
        apportion(believers, adultCounts).forEach((n, i) => {
          if (n <= 0) return;
          const contribution = beliefContribution({ faith: STAT_SEED_FAITH, understanding: 0, devotion: 0 });
          sc.bands[i].belief[sid] = {
            sumFaith: n * STAT_SEED_FAITH,
            sumU: 0,
            sumD: 0,
            sumContribution: n * contribution,
            believerCount: n,
            durableCount: 0,
          };
        });
      }
    }
    out.set(poi.id, sc);
  }
  return out;
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
