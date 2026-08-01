/**
 * SettlementFluxTally (interaction-scaling P1, S1.2) — the meter for the one
 * genuine CROSS-SETTLEMENT people-flow the sim already produces and never
 * counted: `MaterializationSystem`'s market-day visitor pull, which draws souls
 * out of a road-neighbour's cohort and stands them in the host's market.
 *
 * Shaped deliberately after `RoadUseTally` (`@/world/road-use`), the codebase's
 * one working flow meter, so the two behave identically under scrub/skip:
 *
 *   • a TRANSIENT raw tally keyed `srcPoi>dstPoi`, incremented by the producer;
 *   • a window anchor `sinceTick` (-1 = uninitialized — the first fold records
 *     `now` and DEFERS measurement, so a window is never mis-sized on a fresh
 *     world or across a time-skip; a plain 0 would collide with a legitimate
 *     tick-0 baseline);
 *   • a periodic fold to a per-game-day rate EMA, which lives on the aggregate
 *     store (`@/sim/settlement-aggregates`) — the transient half rides the
 *     Snapshot, the folded half persists with the store. Same split roadUse uses
 *     (raw tally on the Snapshot, folded `edge.use` on the map).
 *
 * SELF-FLOW IS NOT RECORDED. The visitor pull has two flavours: everyday LOCAL
 * bustle (src === host) and the weekly market-day pull from neighbours
 * (src !== host). Only the second is settlement-to-settlement flux — the "bound
 * state" signal the scaling work is after — so `noteVisitor` drops same-POI
 * pairs rather than polluting a settlement's in/out totals with its own crowd.
 *
 * Deterministic: plain integer counters, no rng, sorted serialization.
 */
import { TICKS_PER_DAY } from '@/core/calendar';

/** Separator inside a flux key. Never legal inside a poiId (ids are slugs). */
const KEY_SEP = '>';

/** The tally key for one directed settlement pair. */
export function fluxKey(srcPoiId: string, dstPoiId: string): string {
  return `${srcPoiId}${KEY_SEP}${dstPoiId}`;
}

/** Split a flux key back into its endpoints (null if malformed). */
export function parseFluxKey(key: string): { srcPoiId: string; dstPoiId: string } | null {
  const i = key.indexOf(KEY_SEP);
  if (i <= 0 || i >= key.length - 1) return null;
  return { srcPoiId: key.slice(0, i), dstPoiId: key.slice(i + 1) };
}

/** Serialized form of the inter-fold raw tally — rides the Snapshot as optional
 *  `settlementFlux?`. Sorted by key for replay-stable ordering (the `roadUse` /
 *  `statCohorts` precedent). */
export interface SettlementFluxSnapshot {
  sinceTick: number;
  flows: [string, number][];
}

/**
 * A full game-day of raw counts before the first meaningful fold, so the folded
 * number really is "visitors per game-day" rather than an hourly sample of a
 * weekly market. Expressed as the calendar constant, never a raw tick literal.
 */
export const FLUX_FOLD_WINDOW_TICKS = TICKS_PER_DAY;

/** EMA smoothing per fold (~2-day half-life at the daily fold cadence): a town
 *  neither gains nor forgets a trade partner in one market day. */
export const FLUX_EMA_ALPHA = 0.3;

/**
 * Pure fold of one measurement window into a per-game-day rate EMA. Never
 * mutates its input; RNG-free. The first fold SEEDS the EMA with the fresh rate
 * (no cold-start lag toward 0) — same shape as `foldEdgeUse`.
 */
export function foldFluxRate(
  prev: number | undefined,
  rawCount: number,
  elapsedTicks: number,
): number {
  if (elapsedTicks <= 0) return prev ?? 0;
  const rate = (rawCount * TICKS_PER_DAY) / elapsedTicks;
  const seeded = prev ?? rate;
  return seeded + FLUX_EMA_ALPHA * (rate - seeded);
}

/**
 * The transient per-pair visitor tally. Incremented by the producer
 * (`MaterializationSystem.spawnVisitors`), read + cleared by the fold on
 * `SettlementAggregateStore`.
 */
export class SettlementFluxTally {
  /** `srcPoi>dstPoi` → raw realized visitors since the last fold. Sparse. */
  private flows = new Map<string, number>();

  /** Tick the current measurement window opened. -1 = uninitialized (see the
   *  module header): the first fold records `now` and defers measurement. */
  sinceTick = -1;

  /** Record one realized visitor drawn from `srcPoiId` into `dstPoiId`'s market.
   *  Same-settlement (local bustle) and blank endpoints are not flux — dropped. */
  noteVisitor(srcPoiId: string, dstPoiId: string): void {
    if (!srcPoiId || !dstPoiId || srcPoiId === dstPoiId) return;
    const k = fluxKey(srcPoiId, dstPoiId);
    this.flows.set(k, (this.flows.get(k) ?? 0) + 1);
  }

  /** Raw visitors accrued on one directed pair since the last fold. */
  rawFlow(srcPoiId: string, dstPoiId: string): number {
    return this.flows.get(fluxKey(srcPoiId, dstPoiId)) ?? 0;
  }

  /** Number of directed pairs with accrued flow (tests / diagnostics). */
  activePairs(): number {
    return this.flows.size;
  }

  /** Every accrued pair, key-sorted (the fold's deterministic walk order). */
  entries(): [string, number][] {
    return [...this.flows.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  }

  /** Reset the accrued counts (the fold reads then clears). */
  clearFlows(): void {
    this.flows.clear();
  }

  serialize(): SettlementFluxSnapshot {
    return { sinceTick: this.sinceTick, flows: this.entries() };
  }

  static fromSnapshot(s: SettlementFluxSnapshot): SettlementFluxTally {
    const t = new SettlementFluxTally();
    t.sinceTick = s.sinceTick ?? -1;
    for (const [k, n] of s.flows ?? []) t.flows.set(k, n);
    return t;
  }
}
