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

// ── the crossing-tier ladder (§4 + §9 decision 4 + §10 redirect) ─────────────
/** Crossing tiers, bottom→top — the SEVEN-rung BUILT ladder (§10: "variety is the spice").
 *  Tier 0 (`log`) is the epic's founding image — §9 decision 4 puts it under promoted trample
 *  corridors pre-adoption too. "No affordance" is NOT a tier: it is the absence of a crossing
 *  entity; natural fords/stepping stones are a property of the WATER, not of this store. */
export type CrossingTier = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** Tier → the `BRIDGE_RECIPES` key that realizes it (canonical preset = `bridge-<key>`).
 *  Kept as plain strings so this module stays pure (no blueprint import); guarded against
 *  drift by the S0 unit tests. (`timber-trestle` still exists as a recipe but is no longer a
 *  ladder rung — `plank-walk` is the light-timber rung above the roundwood grammars.) */
export const CROSSING_TIER_RECIPES = ['log', 'twin-log', 'log-rail', 'plank-walk', 'timber-beam', 'timber-arch', 'stone-arch'] as const;

/** Human labels for the tiers (studio readouts / events). */
export const CROSSING_TIER_LABELS = ['log', 'twin logs', 'log + rail', 'plank walk', 'timber beam', 'timber arch', 'stone arch'] as const;

/** The tier a road class SUPPORTS (before the lag): the crossing can never outrun the road's
 *  earned class. 7 tiers over 4 classes — a path saturates at the railed logs, a track at the
 *  plank walk, a road at the timber arch; only a `highway` carries the grand stone arch. */
export const CLASS_CROSSING_TIER: Record<RoadClass, CrossingTier> = { path: 2, track: 3, road: 5, highway: 6 };

/** Bridges are expensive: the road earns its class FIRST, the crossing catches up a year-pass
 *  later — the crossing holds at most `CLASS_CROSSING_TIER[class] − CROSSING_LAG`. */
export const CROSSING_LAG = 1;

/** Wealth buyback: endpoint wealth ≥ this ⇒ LAG 0 — a rich town bridges ahead of its traffic. */
export const RICH_CROSSING_MIN = 0.7;

/**
 * Per-tier EARN thresholds on `use.ema01`, INTERPOLATED between the §3 promote points (one
 * statistic, two consumers — the class ladder's thresholds anchor the crossing ladder):
 *
 *   anchors:  use 0 ⇒ tier 0 (the log floor) · PROMOTE_USE.track ⇒ tier 3 (the track cap)
 *             · PROMOTE_USE.road ⇒ tier 5 (the road cap) · PROMOTE_USE.highway ⇒ tier 6
 *
 * The rungs BETWEEN anchors get thresholds at even subdivisions of the gap: tiers 1–2 split
 * [0, PROMOTE.track] in thirds; tier 4 sits halfway across [PROMOTE.track, PROMOTE.road].
 * So a corridor's use walks the low roundwood rungs one by one instead of jumping grammar.
 */
export const CROSSING_EARN_USE: readonly number[] = [
  0,                                                       // 0 log — the floor
  PROMOTE_USE.track / 3,                                   // 1 twin logs
  (2 * PROMOTE_USE.track) / 3,                             // 2 log + rail
  PROMOTE_USE.track,                                       // 3 plank walk   (track cap)
  (PROMOTE_USE.track + PROMOTE_USE.road) / 2,              // 4 timber beam
  PROMOTE_USE.road,                                        // 5 timber arch  (road cap)
  PROMOTE_USE.highway,                                     // 6 stone arch   (highway cap)
];

/**
 * The crossing tier an edge's crossing has EARNED (§4). Pure; the S3 store applies the same
 * streak/hysteresis discipline as the class ladder on top of this target (and never physically
 * un-builds on demotion — a stranded stone bridge on a demoted track just stops being maintained).
 *
 *  - `use01` earns a rung through `CROSSING_EARN_USE` (interpolated off the SAME promote
 *    thresholds as the class ladder — one statistic, two consumers);
 *  - the edge's ACTUAL class caps it (tier-behind-class);
 *  - LAG = 1 is subtracted (wealth ≥ RICH_CROSSING_MIN buys it back to 0);
 *  - floored at tier 0 — any graph/adopted edge crossing water gets at least the log.
 */
export function tierForUse(use01: number, roadClass: RoadClass, wealth01: number): CrossingTier {
  const u = clamp01(use01);
  const lag = clamp01(wealth01) >= RICH_CROSSING_MIN ? 0 : CROSSING_LAG;
  let earned = 0;
  for (let t = 1; t < CROSSING_EARN_USE.length; t++) if (u >= CROSSING_EARN_USE[t]) earned = t;
  const cap = CLASS_CROSSING_TIER[roadClass] ?? 2;
  const tier = Math.min(earned, cap) - lag;
  return (tier < 0 ? 0 : tier) as CrossingTier;
}

// ── stream width vs structure (the §10 "what happens at different streams?" seam) ──
/** Max CLEAR span (tiles; 1 tile = 2 m) each tier's structure can carry across open water
 *  before physics says no: a single log spans ~2 tiles; the twin/railed logs the same
 *  (rails add safety, not span); the plank walk multiplies BENTS so it walks much wider;
 *  a single sawn beam is span-limited between its footings; the arches grow by adding bays.
 *  Studio display + S3's min-viable-structure check both read this one table. */
export const CROSSING_TIER_MAX_SPAN_T: readonly number[] = [2, 2, 2.5, 8, 5, 9, 14];

/** True iff `tier` can physically carry a crossing of this clear span. */
export function tierSpans(tier: CrossingTier, spanTiles: number): boolean {
  return spanTiles <= (CROSSING_TIER_MAX_SPAN_T[tier] ?? 0);
}

/** The LOWEST tier able to span this water (the min viable structure), or null when nothing
 *  on the ladder can (that's a ferry, not a bridge). NOT monotonic in tier — a plank walk
 *  (bents) out-spans a single sawn beam — which is exactly the studio's teaching point. */
export function minViableTier(spanTiles: number): CrossingTier | null {
  for (let t = 0; t < CROSSING_TIER_MAX_SPAN_T.length; t++) {
    if (spanTiles <= CROSSING_TIER_MAX_SPAN_T[t]) return t as CrossingTier;
  }
  return null;
}
