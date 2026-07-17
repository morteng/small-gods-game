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
import type { RoadClass, RoadEdge, RoadGraph } from '@/world/road-graph';
import { TICKS_PER_DAY, DAYS_PER_YEAR } from '@/core/calendar';

const TICKS_PER_YEAR = TICKS_PER_DAY * DAYS_PER_YEAR;

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

// ── the `use` statistic (S1): the measured tally + the year-pass fold ─────────
// One number, two consumers. S1 makes the number REAL (measured footfall folded into a
// per-edge EMA, persisted + scrub-safe) but nothing READS it yet — the class ladder
// (`stepEdgeClass`) and crossing ladder (`tierForUse`) start consuming `edge.use.ema01`
// in S2/S3. Deterministic + RNG-free throughout (pure integer footfall arithmetic).

/** The folded per-edge use state — persisted verbatim WITH THE GRAPH (rides `SaveFile.map`
 *  exactly like `edge.dynamics`; absent = a new edge, no save migration). */
export interface EdgeUse {
  /** Smoothed use statistic in [0,1] — the one number both ladders read (from S2 on). */
  ema01: number;
  /** Lifetime raw passes folded into this edge (diagnostic / studio readout). */
  tallies: number;
  /** Sim tick of the last fold. */
  sinceTick: number;
}

/** `use01 = clamp01(W_TRAFFIC·traffic + W_WEALTH·wealth)` — traffic decides *whether* a route
 *  climbs, wealth decides *how fast/far*. Provisional weights; the S0/crossing studio dials
 *  settle them empirically (spec §8.5) — do NOT hand-tune in prod. */
export const USE_W_TRAFFIC = 0.65;
export const USE_W_WEALTH = 0.35;

/** EMA smoothing per year-pass fold: the world neither learns nor forgets a route's importance
 *  in a single season. 0.5 = a ~1-fold half-life at the ~0.5 y fold cadence. */
export const USE_EMA_ALPHA = 0.5;

/** Passes per road CELL per fiction-year that SATURATE the measured-traffic term, per class: a
 *  highway must carry far more feet than a footpath before it reads "busy". PROVISIONAL — the
 *  studio dials calibrate these against real NPC footfall (a fiction-year is `DAYS_PER_YEAR`
 *  real days at rate 1, so a cell sees many short visits). */
export const EXPECTED_PASSES_PER_CELL_YEAR: Record<RoadClass, number> = {
  path: 20, track: 60, road: 150, highway: 400,
};

/**
 * Pure fold of ONE year-pass into an edge's use EMA. Never mutates its input; RNG-free.
 *  - `traffic` = max(measured, inferred floor) so a pure-cohort route with no live footfall
 *    still reads its statistical importance (both population tiers feed use — spec §2);
 *  - the first fold SEEDS the EMA with the fresh value (no cold-start lag toward 0).
 */
export function foldEdgeUse(
  prev: EdgeUse | undefined,
  measuredNorm: number,
  trafficFloor: number,
  wealth01: number,
  now: number,
  rawAdded: number,
): EdgeUse {
  const traffic = Math.max(clamp01(measuredNorm), clamp01(trafficFloor));
  const use01 = clamp01(USE_W_TRAFFIC * traffic + USE_W_WEALTH * clamp01(wealth01));
  const seeded = prev?.ema01 ?? use01;
  const ema01 = clamp01(seeded + USE_EMA_ALPHA * (use01 - seeded));
  return { ema01, tallies: (prev?.tallies ?? 0) + Math.max(0, rawAdded), sinceTick: now };
}

/** Serialized form of the inter-fold raw tally — rides the Snapshot as optional `roadUse?`
 *  (the transient counter must scrub with the timeline; the FOLDED `edge.use` rides the map).
 *  Sorted by edgeId for replay-stable ordering (the `statCohorts` precedent). */
export interface RoadUseSnapshot {
  sinceTick: number;
  passes: [string, number][];
}

/**
 * The per-edge footfall tally (S1). The 3 Hz trample deposit fire increments it when an NPC
 * stands on a road/bridge tile (roads are trample-inert, so that footfall is discarded today);
 * the year-pass fold reads + resets it into `edge.use`. Tile→edge lookup goes through a
 * `Uint16Array` index memoized on `graph.rev`. Deterministic; no RNG.
 */
export class RoadUseTally {
  /** edgeId → raw passes accrued since the last fold. Sparse. */
  private passes = new Map<string, number>();
  /** Tick the current measurement window opened (the fold-window anchor). -1 = uninitialized:
   *  the first fold records `now` and defers measurement, so a window is never mis-sized on a
   *  fresh world OR after a time-skip (the window spans the skip and dilutes pre-skip footfall
   *  correctly, without the fold ever needing to touch time-skip.ts). A plain 0 sentinel would
   *  collide with a legitimate tick-0 baseline (a fresh non-browser world starts at tick 0). */
  sinceTick = -1;
  /** tile→edge memo: value = edgeIndex+1 (0 = no road). Rebuilt on graph.rev / dimension change. */
  private index: { rev: number; width: number; height: number; arr: Uint16Array } | null = null;

  private ensureIndex(graph: RoadGraph, width: number, height: number): Uint16Array {
    const rev = graph.rev ?? 0;
    const idx = this.index;
    if (idx && idx.rev === rev && idx.width === width && idx.height === height) return idx.arr;
    const arr = new Uint16Array(width * height);
    // Uint16 caps at 65535 edges — far above any real graph; guard so a pathological one can't
    // alias edge 0 (the "no road" sentinel).
    const n = Math.min(graph.edges.length, 0xffff);
    for (let i = 0; i < n; i++) {
      const code = i + 1;
      for (const c of graph.edges[i].polyline) {
        // Stamp the cell AND its 8 neighbours so a widened carriage still resolves to its edge.
        // Lookups are gated on "is this a road tile" (see the deposit hook), so a radius stamp
        // never over-attributes — grass beside a road is never counted. Last writer wins on
        // overlap (two edges sharing cells → the later edge; a harmless statistical tie-break).
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const x = c.x + dx, y = c.y + dy;
            if (x < 0 || y < 0 || x >= width || y >= height) continue;
            arr[y * width + x] = code;
          }
        }
      }
    }
    this.index = { rev, width, height, arr };
    return arr;
  }

  /** Attribute one footfall at road tile (tx,ty) to its covering edge. No-op off any edge. */
  noteFootfall(graph: RoadGraph, tx: number, ty: number, width: number, height: number): void {
    if (tx < 0 || ty < 0 || tx >= width || ty >= height) return;
    const code = this.ensureIndex(graph, width, height)[ty * width + tx];
    if (!code) return;
    const id = graph.edges[code - 1]?.id;
    if (id === undefined) return;
    this.passes.set(id, (this.passes.get(id) ?? 0) + 1);
  }

  /** Raw passes accrued for an edge since the last fold (0 when untouched). */
  rawPasses(edgeId: string): number {
    return this.passes.get(edgeId) ?? 0;
  }

  /** Number of edges with accrued passes (tests / diagnostics). */
  activeEdges(): number {
    return this.passes.size;
  }

  /** Reset the accrued passes (the fold reads then clears; stale ids from a rebuilt graph drop). */
  clearPasses(): void {
    this.passes.clear();
  }

  /** Drop the tile→edge memo (call when the graph is rebuilt WITHOUT a rev bump). */
  invalidateIndex(): void {
    this.index = null;
  }

  serialize(): RoadUseSnapshot {
    const passes = [...this.passes.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    return { sinceTick: this.sinceTick, passes };
  }

  static fromSnapshot(s: RoadUseSnapshot): RoadUseTally {
    const t = new RoadUseTally();
    t.sinceTick = s.sinceTick ?? -1;
    for (const [id, n] of s.passes ?? []) t.passes.set(id, n);
    return t;
  }
}

/** Per-edge inputs the year-pass fold reads from the connectome (built by `buildRoadUseInputs`
 *  in road-evolution.ts, which owns the endpoint-POI plumbing). */
export interface RoadUseFoldInputs {
  /** Endpoint wealth 0..1 (mean prosperity × liveness) — the "purse" behind the traffic. */
  wealthFor(edge: RoadEdge): number;
  /** Inferred-traffic FLOOR 0..1 (endpoint vitality) so a pure-cohort route with no live
   *  footfall never reads as dead (spec §2 — both population tiers feed use). */
  trafficFloorFor(edge: RoadEdge): number;
}

/**
 * Fold the accrued footfall into every edge's `use` EMA and reset the tally. Called at the
 * year-pass (gated by the caller on the same ≥0.5 y cadence as road evolution). Returns the
 * measured window in fiction-years (0 on the baseline-establishing first call). Deterministic.
 *
 * The measurement window is the tally's OWN `(now − sinceTick)`, not the road-evolution
 * `dtYears` — this is what makes the fold skip-safe with no time-skip.ts change: after a jump,
 * the window spans the skipped years, so a burst of pre-skip footfall dilutes to ~0 measured
 * (an abandoned road correctly reads low), exactly as live-ticking those empty years would.
 */
export function foldRoadUse(graph: RoadGraph, tally: RoadUseTally, now: number, inputs: RoadUseFoldInputs): number {
  if (tally.sinceTick < 0) {
    tally.sinceTick = now; // establish the window baseline; measure from the next fold on
    return 0;
  }
  const windowYears = Math.max(1e-9, (now - tally.sinceTick) / TICKS_PER_YEAR);
  for (const edge of graph.edges) {
    const raw = tally.rawPasses(edge.id);
    const lenT = Math.max(1, edge.polyline.length);
    const expected = EXPECTED_PASSES_PER_CELL_YEAR[edge.class] ?? EXPECTED_PASSES_PER_CELL_YEAR.track;
    const measuredNorm = clamp01(raw / (lenT * windowYears * expected));
    edge.use = foldEdgeUse(edge.use, measuredNorm, inputs.trafficFloorFor(edge), inputs.wealthFor(edge), now, raw);
  }
  tally.clearPasses();
  tally.sinceTick = now;
  return windowYears;
}
