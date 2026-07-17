// src/world/road-use.ts
// Road-wear economy — the PURE half (S0 of the road-wear epic, spec:
// docs/superpowers/specs/2026-07-17-road-wear-economy-spec.md).
//
// One statistic (per-edge `use01` — sustained traffic weighted by endpoint wealth) drives TWO
// ladders: the road-class ladder (§3, `stepEdgeClass`) and the crossing-tier ladder (§4,
// `tierForUse`). This module holds only the pure threshold/hysteresis functions and their named
// constants: the S0 studio dials drive EXACTLY these functions, and the later sim slices (S1
// tally → S2 year-pass → S3 crossing store) wire into the same functions — no forked logic, ever.
//
// Nothing here touches the sim, the graph, or persistence. Deterministic, RNG-free, allocation-
// light: safe to call from the studio per input event AND from the year-pass per edge.
import type { RoadClass } from '@/world/road-graph';

// ── the class ladder (§3) ────────────────────────────────────────────────────
/** The graph-side ladder, bottom→top. (The rungs below `path` — bare ground → trample trail —
 *  belong to the trample system; adoption (S4) is the seam between the two.) */
export const ROAD_CLASS_LADDER: readonly RoadClass[] = ['path', 'track', 'road', 'highway'];

/** A class that can be promoted INTO / demoted OUT OF (everything above the `path` floor). */
export type UpperRoadClass = Exclude<RoadClass, 'path'>;

/** Promotion thresholds, keyed by the class being promoted INTO: promote when
 *  `use.ema01 ≥ PROMOTE_USE[next]` for N_UP consecutive applies. */
export const PROMOTE_USE: Record<UpperRoadClass, number> = { track: 0.35, road: 0.55, highway: 0.75 };

/** Demotion thresholds, keyed by the CURRENT class: demote when `use.ema01 < DEMOTE_USE[current]`
 *  for N_DOWN consecutive applies. `PROMOTE_USE[c] > DEMOTE_USE[c]` with a real gap — the
 *  hysteresis band (same anti-flicker design as TRAMPLE.PROMOTE_HI/REVERT_LO). */
export const DEMOTE_USE: Record<UpperRoadClass, number> = { track: 0.15, road: 0.30, highway: 0.50 };

/** Consecutive qualifying year-passes required to promote (≥ 1 fiction-year sustained — a
 *  festival spike doesn't pave a road). */
export const N_UP = 2;
/** Consecutive qualifying year-passes required to demote (≥ 2 years — the world forgets slower
 *  than it learns). */
export const N_DOWN = 4;

/** Consecutive-apply streak counters for one edge (persisted in `edge.use` from S1 on). */
export interface UseStreaks {
  up: number;
  down: number;
}

/** Result of one year-pass application of the class ladder to an edge. */
export interface EdgeClassStep {
  /** The class after this apply (== `current` when nothing changed). */
  next: RoadClass;
  /** The streak counters after this apply (fresh object — the input is never mutated). */
  streaks: UseStreaks;
  /** True iff this apply moved the class (exactly one step, by construction). */
  changed: boolean;
}

function clamp01(v: number): number {
  return Number.isFinite(v) ? (v < 0 ? 0 : v > 1 ? 1 : v) : 0;
}

/**
 * Apply ONE year-pass of the class ladder (§3) to an edge. Pure: returns the next class + fresh
 * streak counters; never mutates its inputs; moves at most ONE rung per apply.
 *
 * Rules:
 *  - promote toward `next` when `ema01 ≥ PROMOTE_USE[next]`, after N_UP consecutive such applies;
 *  - demote toward `prev` when `ema01 < DEMOTE_USE[current]`, after N_DOWN consecutive applies;
 *  - anything in the hysteresis band between the two thresholds is a NON-qualifying apply and
 *    breaks both streaks (streaks are "consecutive applies", not lifetime tallies);
 *  - `path` is the graph floor (demotion below `path` — un-adoption — is a named S4+ follow-up);
 *  - `highway` promotion is LORD-GATED (§9 decision 1: gate only, no spend): without
 *    `hasLordSeat` the apply does not qualify — the edge saturates at `road` and no up-streak
 *    accrues (a seat arriving later still needs N_UP qualifying applies from scratch).
 */
export function stepEdgeClass(
  current: RoadClass,
  ema01: number,
  streaks: UseStreaks,
  hasLordSeat = false,
): EdgeClassStep {
  const i = ROAD_CLASS_LADDER.indexOf(current);
  const u = clamp01(ema01);
  const promoteTo = i >= 0 ? (ROAD_CLASS_LADDER[i + 1] as UpperRoadClass | undefined) : undefined;
  const canPromote = promoteTo !== undefined && (promoteTo !== 'highway' || hasLordSeat);
  if (canPromote && u >= PROMOTE_USE[promoteTo!]) {
    const up = streaks.up + 1;
    if (up >= N_UP) return { next: promoteTo!, streaks: { up: 0, down: 0 }, changed: true };
    return { next: current, streaks: { up, down: 0 }, changed: false };
  }
  if (i > 0 && u < DEMOTE_USE[current as UpperRoadClass]) {
    const down = streaks.down + 1;
    if (down >= N_DOWN) return { next: ROAD_CLASS_LADDER[i - 1], streaks: { up: 0, down: 0 }, changed: true };
    return { next: current, streaks: { up: 0, down }, changed: false };
  }
  // Hysteresis dead band (or an ungated/topped-out edge): a non-qualifying apply — streaks break.
  return { next: current, streaks: { up: 0, down: 0 }, changed: false };
}

// ── the crossing-tier ladder (§4 + §9 decision 4) ────────────────────────────
/** Crossing tiers, bottom→top. Tier 0 (`log`) is the epic's founding image — §9 decision 4 puts
 *  it under promoted trample corridors pre-adoption too, so the ladder has FIVE rungs. */
export type CrossingTier = 0 | 1 | 2 | 3 | 4;

/** Tier → the `BRIDGE_RECIPES` key that realizes it (canonical preset = `bridge-<key>`).
 *  Tier 1 "log-plank" is the shipped driven-pile trestle recipe. Kept as plain strings so this
 *  module stays pure (no blueprint import); guarded against drift by the S0 unit tests. */
export const CROSSING_TIER_RECIPES = ['log', 'timber-trestle', 'timber-beam', 'timber-arch', 'stone-arch'] as const;

/** Human labels for the tiers (studio readouts / events). */
export const CROSSING_TIER_LABELS = ['log', 'log-plank', 'timber-beam', 'timber-arch', 'stone-arch'] as const;

/** The tier a road class SUPPORTS (before the lag): the crossing can never outrun the road's
 *  earned class. 5 tiers over 4 classes — only a `highway` can carry the grand stone arch. */
export const CLASS_CROSSING_TIER: Record<RoadClass, CrossingTier> = { path: 1, track: 2, road: 3, highway: 4 };

/** Bridges are expensive: the road earns its class FIRST, the crossing catches up a year-pass
 *  later — the crossing holds at most `CLASS_CROSSING_TIER[class] − CROSSING_LAG`. */
export const CROSSING_LAG = 1;

/** Wealth buyback: endpoint wealth ≥ this ⇒ LAG 0 — a rich town bridges ahead of its traffic. */
export const RICH_CROSSING_MIN = 0.7;

/**
 * The crossing tier an edge's crossing has EARNED (§4). Pure; the S3 store applies the same
 * streak/hysteresis discipline as the class ladder on top of this target (and never physically
 * un-builds on demotion — a stranded stone bridge on a demoted track just stops being maintained).
 *
 *  - `use01` earns a rung through the SAME promote thresholds as the class ladder (one statistic,
 *    two consumers): the earned rung is the tier of the class this use level would sustain;
 *  - the edge's ACTUAL class caps it (tier-behind-class);
 *  - LAG = 1 is subtracted (wealth ≥ RICH_CROSSING_MIN buys it back to 0);
 *  - floored at tier 0 — any graph/adopted edge crossing water gets at least the log.
 */
export function tierForUse(use01: number, roadClass: RoadClass, wealth01: number): CrossingTier {
  const u = clamp01(use01);
  const lag = clamp01(wealth01) >= RICH_CROSSING_MIN ? 0 : CROSSING_LAG;
  let earned: CrossingTier = 1;                 // any graph edge sustains at least the path rung
  if (u >= PROMOTE_USE.track) earned = 2;
  if (u >= PROMOTE_USE.road) earned = 3;
  if (u >= PROMOTE_USE.highway) earned = 4;
  const cap = CLASS_CROSSING_TIER[roadClass] ?? 1;
  const tier = Math.min(earned, cap) - lag;
  return (tier < 0 ? 0 : tier) as CrossingTier;
}
