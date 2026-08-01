/**
 * SettlementAggregates (interaction-scaling P1, S1.1) — ONE per-settlement sweep
 * covering BOTH population tiers, replacing the "four duplicate O(N) sweeps that
 * must not disagree" convention the 2026-08-01 audit found (`residentsByPoi`,
 * `censusBelieversByPoi`, `buildRivalSituation`, `censusCohorts`) with a store
 * they can all eventually read.
 *
 * Modelled EXACTLY on `buildRivalSituation` (`@/sim/rival-claims`), whose
 * conventions are the shipped, replay-proven ones:
 *
 *   • ONE `forEachNpc` pass for the NAMED tier, then a fold over
 *     `[...cohorts.keys()].sort()` for the STATISTICAL tier — sorted so float
 *     sums are replay-stable regardless of Map insertion order;
 *   • plain counts / records only, so the result snapshots trivially;
 *   • TRENDS REQUIRE AN EXPLICIT BASELINE. No baseline ⇒ no trend field at all,
 *     never "everything is growth" (the `rivalFollowerDelta` rule);
 *   • unhomed named souls bucket under `''`, the same key `buildRivalSituation`
 *     and `censusBelieversByPoi` use, so per-settlement conservation balances
 *     globally.
 *
 * NEEDS STAY DIRECTIONAL. `needPressure` is FOUR separate numbers, never a
 * scalar mean — a settlement whose prosperity is collapsing while its safety is
 * fine must read differently from one that is uniformly mediocre, or every
 * later phase's observables are mush (VISION §9 row 11). See the field doc for
 * the sign convention.
 *
 * Phase 1 is PURE MEASUREMENT: nothing here writes to the world, and no
 * gameplay reads it except `GameQuery` (the O(N) `settlement().npcCount` sweep).
 * Deterministic; no rng.
 */
import type { World } from '@/world/world';
import type { Spirit, SpiritId } from '@/core/spirit';
import type { NpcNeeds } from '@/core/types';
import { forEachNpc, npcProps } from '@/world/npc-helpers';
import { BELIEVER_THRESHOLD, isDurable } from '@/sim/believers';
import { cohortPopulation, type SettlementCohorts } from '@/sim/cohorts';
import { PRAYER_CLAIM_WARNING_TICKS, prayerAge } from '@/sim/rival-claims';
import {
  SettlementFluxTally, FLUX_FOLD_WINDOW_TICKS, foldFluxRate, fluxKey, parseFluxKey,
} from '@/sim/settlement-flux';

/** One spirit's standing in one settlement, folded over both population tiers. */
export interface SettlementBelieverStats {
  /** Practising believers — faith ≥ `BELIEVER_THRESHOLD`. Matches
   *  `censusBelieversByPoi` / `buildRivalSituation` exactly. */
  count: number;
  /** The stricter `isDurable` set (what the pantheon and power economy count). */
  durable: number;
  /** Σ faith over the settlement's WHOLE population, both tiers — non-believers
   *  dilute. This is the one mean-faith definition the statistical tier can
   *  express EXACTLY (its running sums have no "holders" denominator), and it is
   *  the same one `dominantCohortBelief` uses. 0 for an empty settlement. */
  meanFaith: number;
}

export interface SettlementAggregate {
  poiId: string;
  population: {
    /** Living `kind:'npc'` entities homed here (includes materialized extras). */
    named: number;
    /** Souls in this settlement's statistical cohort bands. */
    statistical: number;
  };
  /** Per-spirit standing, only for spirits still present in `spirits` (a belief
   *  toward a departed god is nobody's follower). Keys are spirit ids. */
  believers: Record<SpiritId, SettlementBelieverStats>;
  /**
   * UNMET need per axis, 0..1, population-weighted over BOTH tiers — i.e.
   * `1 − meanSatisfaction`, so HIGHER = MORE PRESSURE and "the worst need" is
   * the argmax. (The raw `NpcNeeds` / `CohortBand.needs` numbers are
   * satisfaction, where higher is better; this record inverts them once, here,
   * so every consumer reads pressure the same way round.) Four separate values,
   * never collapsed to a scalar. An empty settlement reads 0 on all four.
   */
  needPressure: NpcNeeds;
  /** Named souls with a plea already old enough to be at risk
   *  (age ≥ `PRAYER_CLAIM_WARNING_TICKS`) — the same quantity
   *  `buildRivalSituation.prayerPressureInSettlement` counts. Statistical-tier
   *  pleas are inert until P2, so they contribute nothing. */
  prayerPressure: number;
  /**
   * Change in total population (named + statistical) since the caller-supplied
   * baseline. ABSENT when no baseline was supplied — an unknown trend is not a
   * flat one, and it is certainly not growth.
   */
  populationTrend?: number;
}

export interface SettlementAggregateOptions {
  /** Current sim tick — needed to age standing pleas. Omitted ⇒ prayer pressure
   *  reads 0 everywhere. */
  now?: number;
  /** The STATISTICAL tier. Omitted ⇒ named-tier-only aggregates. */
  cohorts?: ReadonlyMap<string, SettlementCohorts> | null;
  /** Total population per poiId as of the previous sweep. Omitted ⇒ no
   *  `populationTrend` is emitted at all (see the field doc). */
  baseline?: ReadonlyMap<string, number> | null;
}

/** Mutable accumulator — needs are summed as SATISFACTION and inverted once at
 *  the end, so the incremental arithmetic matches the raw fields it reads. */
interface Acc {
  named: number;
  statistical: number;
  believers: Map<SpiritId, { count: number; durable: number; faithSum: number }>;
  needSum: NpcNeeds;
  prayerPressure: number;
}

function emptyAcc(): Acc {
  return {
    named: 0,
    statistical: 0,
    believers: new Map(),
    needSum: { safety: 0, prosperity: 0, community: 0, meaning: 0 },
    prayerPressure: 0,
  };
}

function bumpBeliever(acc: Acc, sid: SpiritId): { count: number; durable: number; faithSum: number } {
  let rec = acc.believers.get(sid);
  if (!rec) acc.believers.set(sid, (rec = { count: 0, durable: 0, faithSum: 0 }));
  return rec;
}

/**
 * Build every settlement's aggregate record in ONE named pass plus one sorted
 * cohort fold. Everything returned is a plain count/record, so it snapshots
 * trivially and two runs over identical state are byte-identical.
 *
 * The returned Map is keyed by poiId in SORTED order (insertion order is the
 * iteration order for Maps, so downstream folds inherit replay stability for
 * free).
 */
export function buildSettlementAggregates(
  world: World,
  spirits: ReadonlyMap<SpiritId, Spirit>,
  opts: SettlementAggregateOptions = {},
): Map<string, SettlementAggregate> {
  const now = opts.now ?? 0;
  const accs = new Map<string, Acc>();
  const accFor = (poiId: string): Acc => {
    let a = accs.get(poiId);
    if (!a) accs.set(poiId, (a = emptyAcc()));
    return a;
  };

  // ── named tier: one pass ──────────────────────────────────────────────────
  forEachNpc(world, (e) => {
    const p = npcProps(e);
    const acc = accFor(p.homePoiId ?? '');
    acc.named++;
    acc.needSum.safety     += p.needs.safety;
    acc.needSum.prosperity += p.needs.prosperity;
    acc.needSum.community  += p.needs.community;
    acc.needSum.meaning    += p.needs.meaning;
    for (const [sid, b] of Object.entries(p.beliefs)) {
      if (!spirits.has(sid)) continue;   // a departed god has no followers
      const rec = bumpBeliever(acc, sid);
      rec.faithSum += b.faith;
      if (b.faith >= BELIEVER_THRESHOLD) rec.count++;
      if (isDurable(b)) rec.durable++;
    }
    if (p.prayerSince !== undefined && prayerAge(p, now) >= PRAYER_CLAIM_WARNING_TICKS) {
      acc.prayerPressure++;
    }
  });

  // ── statistical tier: sorted fold (replay-stable float sums) ──────────────
  if (opts.cohorts) {
    const sids = [...spirits.keys()].sort();
    for (const poiId of [...opts.cohorts.keys()].sort()) {
      const sc = opts.cohorts.get(poiId)!;
      const acc = accFor(poiId);
      acc.statistical += cohortPopulation(sc);
      for (const band of sc.bands) {
        if (band.count <= 0) continue;
        acc.needSum.safety     += band.needs.safety     * band.count;
        acc.needSum.prosperity += band.needs.prosperity * band.count;
        acc.needSum.community  += band.needs.community  * band.count;
        acc.needSum.meaning    += band.needs.meaning    * band.count;
      }
      for (const sid of sids) {
        let count = 0, durable = 0, faithSum = 0;
        for (const band of sc.bands) {
          const b = band.belief[sid];
          if (!b) continue;
          count += b.believerCount;
          durable += b.durableCount;
          faithSum += b.sumFaith;
        }
        if (count === 0 && durable === 0 && faithSum === 0) continue;
        const rec = bumpBeliever(acc, sid);
        rec.count += count;
        rec.durable += durable;
        rec.faithSum += faithSum;
      }
    }
  }

  // ── finalize: means, pressure inversion, explicit-baseline trend ──────────
  const out = new Map<string, SettlementAggregate>();
  for (const poiId of [...accs.keys()].sort()) {
    const acc = accs.get(poiId)!;
    const total = acc.named + acc.statistical;
    const denom = total || 1;
    const believers: Record<SpiritId, SettlementBelieverStats> = {};
    for (const sid of [...acc.believers.keys()].sort()) {
      const rec = acc.believers.get(sid)!;
      believers[sid] = { count: rec.count, durable: rec.durable, meanFaith: rec.faithSum / denom };
    }
    const agg: SettlementAggregate = {
      poiId,
      population: { named: acc.named, statistical: acc.statistical },
      believers,
      needPressure: total > 0
        ? {
          safety:     1 - acc.needSum.safety / denom,
          prosperity: 1 - acc.needSum.prosperity / denom,
          community:  1 - acc.needSum.community / denom,
          meaning:    1 - acc.needSum.meaning / denom,
        }
        : { safety: 0, prosperity: 0, community: 0, meaning: 0 },
      prayerPressure: acc.prayerPressure,
    };
    // No baseline ⇒ no trend. An unknown trend is not a flat one.
    if (opts.baseline) agg.populationTrend = total - (opts.baseline.get(poiId) ?? 0);
    out.set(poiId, agg);
  }
  return out;
}

/** Total population (both tiers) per poiId — the baseline shape the next sweep's
 *  `populationTrend` is measured against. */
export function populationBaseline(
  aggregates: ReadonlyMap<string, SettlementAggregate>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const [poiId, a] of aggregates) out.set(poiId, a.population.named + a.population.statistical);
  return out;
}

/** Serialized store — rides the Snapshot as optional `settlementAggregates?`. */
export interface SettlementAggregateStoreSnapshot {
  computedTick: number;
  /** poiId-sorted records. */
  aggregates: SettlementAggregate[];
  /** key-sorted `srcPoi>dstPoi` → visitors per game-day EMA. */
  fluxEma: [string, number][];
  /** Tick of the last completed flux fold (-1 = none yet). */
  fluxFoldedTick: number;
}

/**
 * The live aggregate store: the latest sweep's records PLUS the folded half of
 * the settlement-flux meter (the transient raw tally rides the Snapshot on its
 * own — see `@/sim/settlement-flux`).
 *
 * Snapshot-authoritative like the road stores: a scrub restores the exact
 * aggregates + flux EMAs the world had at that tick, so a scrubbed timeline
 * can't inherit a discarded future's numbers for the up-to-a-game-hour it would
 * take the sweep to run again.
 */
export class SettlementAggregateStore {
  private aggregates = new Map<string, SettlementAggregate>();
  private fluxEma = new Map<string, number>();

  /** Sim tick of the last sweep. -1 = never swept (callers fall back). */
  computedTick = -1;
  /** Sim tick of the last completed flux fold. -1 = none yet. */
  fluxFoldedTick = -1;

  /** Install a fresh sweep. Takes ownership of the passed map. */
  replace(aggregates: Map<string, SettlementAggregate>, now: number): void {
    this.aggregates = aggregates;
    this.computedTick = now;
  }

  get(poiId: string): SettlementAggregate | undefined {
    return this.aggregates.get(poiId);
  }

  /** Every record, poiId-sorted (the builder's own insertion order). */
  all(): ReadonlyMap<string, SettlementAggregate> {
    return this.aggregates;
  }

  size(): number {
    return this.aggregates.size;
  }

  /** Visitors per game-day on one directed pair (0 when never folded). */
  fluxFor(srcPoiId: string, dstPoiId: string): number {
    return this.fluxEma.get(fluxKey(srcPoiId, dstPoiId)) ?? 0;
  }

  /** Every folded pair, key-sorted. */
  fluxEntries(): [string, number][] {
    return [...this.fluxEma.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  }

  /** Visitors per game-day arriving at / departing from one settlement. */
  fluxInFor(poiId: string): number {
    let n = 0;
    for (const [k, v] of this.fluxEntries()) {
      if (parseFluxKey(k)?.dstPoiId === poiId) n += v;
    }
    return n;
  }

  fluxOutFor(poiId: string): number {
    let n = 0;
    for (const [k, v] of this.fluxEntries()) {
      if (parseFluxKey(k)?.srcPoiId === poiId) n += v;
    }
    return n;
  }

  /**
   * Fold one measurement window of the raw tally into the per-game-day EMAs,
   * then reset the window. No-op until a full `FLUX_FOLD_WINDOW_TICKS` has
   * elapsed, so the folded number really is a per-day rate rather than an
   * hourly sample of a weekly market. An uninitialized tally (`sinceTick < 0`)
   * only gets its anchor set — the `RoadUseTally` deferral, which is also what
   * makes a time-skip free (the window spans the skip and dilutes correctly).
   *
   * Returns true when a fold actually happened.
   */
  foldFlux(tally: SettlementFluxTally, now: number): boolean {
    if (tally.sinceTick < 0) {
      tally.sinceTick = now;
      return false;
    }
    const elapsed = now - tally.sinceTick;
    if (elapsed < FLUX_FOLD_WINDOW_TICKS) return false;
    const raw = new Map(tally.entries());
    // Walk the UNION of folded + freshly-tallied keys, sorted, so a pair that
    // saw no traffic this window decays instead of freezing at its old rate.
    for (const k of [...new Set([...this.fluxEma.keys(), ...raw.keys()])].sort()) {
      this.fluxEma.set(k, foldFluxRate(this.fluxEma.get(k), raw.get(k) ?? 0, elapsed));
    }
    tally.clearFlows();
    tally.sinceTick = now;
    this.fluxFoldedTick = now;
    return true;
  }

  serialize(): SettlementAggregateStoreSnapshot {
    return {
      computedTick: this.computedTick,
      aggregates: [...this.aggregates.values()].map(a => structuredClone(a)),
      fluxEma: this.fluxEntries(),
      fluxFoldedTick: this.fluxFoldedTick,
    };
  }

  static fromSnapshot(s: SettlementAggregateStoreSnapshot): SettlementAggregateStore {
    const store = new SettlementAggregateStore();
    store.computedTick = s.computedTick ?? -1;
    store.fluxFoldedTick = s.fluxFoldedTick ?? -1;
    for (const a of s.aggregates ?? []) store.aggregates.set(a.poiId, structuredClone(a));
    for (const [k, v] of s.fluxEma ?? []) store.fluxEma.set(k, v);
    return store;
  }
}
