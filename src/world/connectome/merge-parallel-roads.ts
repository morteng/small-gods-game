// src/world/connectome/merge-parallel-roads.ts
//
// The connectivity-PRESERVING merge for "parallel roads between the same places" (#26).
// Where two roads run near-parallel for a long stretch (the `road.parallel-corridor` lint
// detects these), the redundant one should be dropped — but NEVER if that splits the road
// network. The safety guarantee is exact: a redundant edge is dropped ONLY when its two
// endpoints stay connected via the rest of the graph WITHOUT it (a non-bridge / cut-edge
// check by BFS). So this can never disconnect a settlement.
//
// PURE (returns a new graph + the dropped edge ids); no `Math.random`, no tile mutation.
// NOTE for the caller (the remaining wiring half of #26): worldgen CARVES road tiles during
// the walk (`buildRoadGraph` → `walkRoad`), decoupled from the graph, so after merging you
// must also un-carve each dropped edge's EXCLUSIVE tiles (those no kept road still covers)
// back to terrain — else the road stays visible as orphaned tiles. That un-carve + the
// re-rasterize is the focused worldgen change this algorithm is the brain of.

import type { RoadGraph, RoadEdge, RoadClass } from '@/world/road-graph';

const CLASS_RANK: Record<RoadClass, number> = { highway: 3, road: 2, track: 1, path: 0 };

/** A parallel corridor must run at least this close, this far, and cover this fraction of
 *  the shorter road — the same thresholds the `road.parallel-corridor` lint rule uses. */
const PROXIMITY_TILES = 2.5;
const MIN_SHARED_TILES = 6;
const MIN_SHARED_FRACTION = 0.5;

function distToSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  if (l2 === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / l2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
function distToPolyline(px: number, py: number, poly: { x: number; y: number }[]): number {
  let best = Infinity;
  for (let i = 0; i + 1 < poly.length; i++) best = Math.min(best, distToSeg(px, py, poly[i].x, poly[i].y, poly[i + 1].x, poly[i + 1].y));
  return best;
}
function polylineLength(poly: { x: number; y: number }[]): number {
  let s = 0;
  for (let i = 0; i + 1 < poly.length; i++) s += Math.hypot(poly[i + 1].x - poly[i].x, poly[i + 1].y - poly[i].y);
  return s;
}
/** Length of `e1` whose segment midpoints lie within proximity of `e2`. */
function sharedRun(e1: RoadEdge, e2: RoadEdge): number {
  let shared = 0;
  for (let k = 0; k + 1 < e1.polyline.length; k++) {
    const a = e1.polyline[k], b = e1.polyline[k + 1];
    if (distToPolyline((a.x + b.x) / 2, (a.y + b.y) / 2, e2.polyline) <= PROXIMITY_TILES) shared += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return shared;
}

/** True if `u` reaches `v` over `edges` (BFS). With the candidate edge already excluded from
 *  `edges`, a `true` result means that edge is NOT a cut edge → dropping it keeps the graph
 *  connected (any path through it reroutes via the u↔v alternate path). */
function connected(edges: RoadEdge[], u: string, v: string): boolean {
  if (u === v) return true;
  const adj = new Map<string, string[]>();
  const link = (a: string, b: string) => { (adj.get(a) ?? adj.set(a, []).get(a)!).push(b); };
  for (const e of edges) { link(e.a, e.b); link(e.b, e.a); }
  const seen = new Set<string>([u]);
  const stack = [u];
  while (stack.length) {
    const x = stack.pop()!;
    if (x === v) return true;
    for (const y of adj.get(x) ?? []) if (!seen.has(y)) { seen.add(y); stack.push(y); }
  }
  return false;
}

export interface MergeResult {
  graph: RoadGraph;
  /** Dropped edge ids (their EXCLUSIVE tiles still need un-carving by the caller — see header). */
  removed: string[];
}

/** Drop the redundant edge of each parallel corridor when it's safe (non-bridge). The kept
 *  edge of a pair is the HIGHER class (more important road); ties break to the shorter one. */
export function mergeParallelRoads(graph: RoadGraph): MergeResult {
  const roads = graph.edges.filter((e) => e.feature === 'road');
  const removed = new Set<string>();
  for (let i = 0; i < roads.length; i++) {
    if (removed.has(roads[i].id)) continue;
    for (let j = i + 1; j < roads.length; j++) {
      if (removed.has(roads[i].id)) break;
      if (removed.has(roads[j].id)) continue;
      const e1 = roads[i], e2 = roads[j];
      const run = sharedRun(e1, e2);
      const minLen = Math.min(polylineLength(e1.polyline), polylineLength(e2.polyline)) || 1;
      if (run < MIN_SHARED_TILES || run < MIN_SHARED_FRACTION * minLen) continue;
      // Redundant = lower class; tie → the LONGER road (the kept one is the tidier short link).
      const r1 = CLASS_RANK[e1.class], r2 = CLASS_RANK[e2.class];
      const cand = r1 < r2 ? e1 : r2 < r1 ? e2 : (polylineLength(e1.polyline) >= polylineLength(e2.polyline) ? e1 : e2);
      const remaining = roads.filter((e) => !removed.has(e.id) && e.id !== cand.id);
      if (connected(remaining, cand.a, cand.b)) removed.add(cand.id);   // safe: not a cut edge
    }
  }
  if (removed.size === 0) return { graph, removed: [] };
  return { graph: { ...graph, edges: graph.edges.filter((e) => !removed.has(e.id)) }, removed: [...removed] };
}
