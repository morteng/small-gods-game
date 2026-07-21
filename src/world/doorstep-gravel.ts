// src/world/doorstep-gravel.ts
//
// T3 — doorstep→world gravel/wear scatter, hooked into the connectome road graph.
// Spec: docs/superpowers/specs/2026-07-21-terrain-texturing-polish-and-perf.md § T3.
//
// A NEW gen-time pass, run once after the road graph + settlement wear prewarm exist. It
// imitates the shape of `settlement-wear.ts`'s doorstep deposit (same door anchor, same
// busy/ordinary split) but radiates OUTWARD along the connected `RoadGraph` instead of a
// local BFS halo: from each building's doorstep it snaps onto the nearest road-graph
// polyline point, then walks the graph in both directions — crossing into every edge that
// shares a node — accumulating tile distance from the door. Distance falloff turns that
// into a score; busy premises (market/tavern/mill/well/temple…) radiate farther and
// stronger than an ordinary dwelling. Cells that clear a promotion threshold become a new
// `gravel` ground tile.type — the packed-earth/pebble apron a doorway spills into the
// world and thins along the path it feeds.
//
// Deliberately SEPARATE from `sim/trample.ts`'s live TrampleGrid: that system is the
// real-time desire-line accumulator NPC footfall feeds; this is a static, one-shot gen
// deposit keyed only on the graph's shape and the seed, with no accumulator state to
// persist or decay. It reads the SAME doorstep (`doorstepTile`/`mainDoorAnchor`/
// `isBusyKind`, all exported from `settlement-wear.ts` for exactly this reuse) so the two
// wear stories agree at the door, but never writes into the trample grid — a cell this
// pass promotes to `gravel` composes fine with a nearby cell the trample system separately
// promotes to `dirt` (both are in `GRAVEL_ELIGIBLE`, so gravel can spread from either).
//
// Deterministic + `Math.random`-free by construction: every value derives from the graph's
// polylines, fixed distance falloff, and `noise(x,y,seed+…)` (the same deterministic
// hash-noise `settlement-wear.ts` already uses for its organic-edge jitter) — never
// `Math.random`. Aggregation is MAX-across-sources over a plain `Map`, so the result is
// independent of building iteration order (mirrors `depositBuildingWear`'s "deposits
// commute" determinism note).
//
// Respects existing ground by WHITELIST, not blacklist: only `GRAVEL_ELIGIBLE` tile types
// (natural soft ground + the trample system's own worn `dirt`) are ever rewritten, so
// roads, bridges, water, lots, farm fields and building footprints (excluded twice over —
// wrong tile.type AND `walkable === false`) are never touched, with no special-casing
// needed at each of those surfaces.

import type { GameMap, Entity } from '@/core/types';
import type { World } from '@/world/world';
import type { SettlementPlan } from '@/world/settlement-plan';
import type { RoadEdge, RoadGraph } from '@/world/road-graph';
import { isBuilding } from './building-collision';
import { doorstepTile, mainDoorAnchor, isBusyKind } from './settlement-wear';
import { SOFT_GROUND } from '@/sim/trample';
import { noise } from '@/core/noise';
import { bumpTilesRev } from '@/core/tile-rev';

/** Ground `tile.type`s this pass may promote to `gravel` — natural soft ground plus the
 *  trample system's own worn-dirt tile, so a doorstep already promoted to dirt (past
 *  `TRAMPLE.PROMOTE_HI`) keeps worsening toward gravel further out instead of the two
 *  systems disagreeing at the boundary. Everything else (road/bridge/water/lot/farm_field/
 *  building footprint) is excluded by simply not being in this set. */
const GRAVEL_ELIGIBLE: ReadonlySet<string> = new Set<string>([...SOFT_GROUND, 'dirt']);

/** Graph-walk reach (tiles) an ordinary dwelling's apron can travel before fading to 0. */
const ORDINARY_REACH = 8;
/** Busy premises (market/tavern/well/mill/temple/forge…) wear a longer, heavier apron. */
const BUSY_REACH = 16;
/** Score (0..1 scale) at the doorstep itself (graph distance 0), before falloff. */
const ORDINARY_STRENGTH = 0.7;
const BUSY_STRENGTH = 1.0;
/** A cell's aggregated score must clear this (± jitter) to promote to gravel. Tuned against
 *  `STRADDLE_MULT` so an ordinary dwelling's road-side apron reaches only ~4-5 tiles while a
 *  busy premises' reaches ~11 — ordinary vs busy read as genuinely different aprons, not just
 *  a raw reach-cap difference. */
const PROMOTE_THRESHOLD = 0.2;
/** Half-amplitude of the per-cell threshold jitter — an organic apron edge, not a hard ring
 *  (same convention as `settlement-wear.ts`'s `CULL_THRESHOLD`/wall-flank jitter). */
const JITTER_AMPLITUDE = 0.12;
/** A cell straddling the road (its 4-neighbours, off the exact polyline/doorstep cell)
 *  scores at this fraction of the on-line cell — the apron beside the path, not just its
 *  centerline (the centerline is usually the road itself, which is never eligible anyway). */
const STRADDLE_MULT = 0.7;
/** How far past a building's `reach` to search for a road-graph snap point before giving up
 *  on it — a building with nothing on the graph within reach contributes nothing (this pass
 *  is graph-hooked by design; it never invents an apron with no road to follow). */
const SNAP_SLACK = 3;

/** Take the max score recorded at (x,y) so far — order-independent aggregation across every
 *  contributing doorstep. */
function bump(scores: Map<string, number>, x: number, y: number, score: number): void {
  if (score <= 0) return;
  const key = `${x},${y}`;
  const prev = scores.get(key);
  if (prev === undefined || score > prev) scores.set(key, score);
}

/** Linear falloff: 1 at distance 0, 0 at distance ≥ `reach`, scaled by `strength`. */
function falloff(dist: number, reach: number, strength: number): number {
  if (dist >= reach) return 0;
  return strength * (1 - dist / reach);
}

/** Bucket size (tiles) for the polyline spatial index — chosen so `BUSY_REACH + SNAP_SLACK`
 *  (the largest snap query radius) needs only a small, fixed bucket neighbourhood, keeping
 *  `nearestGraphPoint` near-constant per building instead of scanning the whole graph. */
const BUCKET_SIZE = 24;
function bucketKey(x: number, y: number): string {
  return `${Math.floor(x / BUCKET_SIZE)},${Math.floor(y / BUCKET_SIZE)}`;
}

/** A spatial index over every edge's polyline points, bucketed for a fast local
 *  `nearestGraphPoint` query. Built ONCE per `depositDoorstepGravel` call — O(total polyline
 *  points) — instead of re-scanning the whole graph for every building's doorstep. */
function buildPolylineIndex(graph: RoadGraph): Map<string, { edge: RoadEdge; index: number }[]> {
  const buckets = new Map<string, { edge: RoadEdge; index: number }[]>();
  for (const edge of graph.edges) {
    for (let i = 0; i < edge.polyline.length; i++) {
      const p = edge.polyline[i];
      const key = bucketKey(p.x, p.y);
      const list = buckets.get(key);
      if (list) list.push({ edge, index: i });
      else buckets.set(key, [{ edge, index: i }]);
    }
  }
  return buckets;
}

/** Nearest point across the graph to (x,y), within `maxDist` tiles, or null if nothing on the
 *  graph is that close (an unconnected building — a legitimate no-op case). Only inspects the
 *  bucket neighbourhood covering `maxDist`, not every polyline point in the whole graph. */
function nearestGraphPoint(
  index: ReadonlyMap<string, { edge: RoadEdge; index: number }[]>, x: number, y: number, maxDist: number,
): { edge: RoadEdge; index: number; dist: number } | null {
  let best: { edge: RoadEdge; index: number; dist: number } | null = null;
  const bx = Math.floor(x / BUCKET_SIZE), by = Math.floor(y / BUCKET_SIZE);
  const r = Math.ceil(maxDist / BUCKET_SIZE);
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const cell = index.get(`${bx + dx},${by + dy}`);
      if (!cell) continue;
      for (const { edge, index: i } of cell) {
        const p = edge.polyline[i];
        const d = Math.hypot(p.x - x, p.y - y);
        if (d > maxDist) continue;
        if (!best || d < best.dist) best = { edge, index: i, dist: d };
      }
    }
  }
  return best;
}

/** Walk the graph outward from a snapped point in both polyline directions, crossing into
 *  every edge sharing a node at each edge's end, calling `visit` at every cell reached with
 *  its cumulative distance from the doorstep. Bounded by `reach`; a per-traversal visited-
 *  edge guard keeps a cyclic graph from looping — since each edge is entered at most once,
 *  the walk always terminates regardless of graph shape (falloff is already 0 well before
 *  any realistic cycle length at these reaches, so the guard is never a visible truncation). */
function walkGraphOutward(
  edgesByNode: ReadonlyMap<string, RoadEdge[]>,
  start: RoadEdge, startIndex: number, startDist: number, reach: number,
  visit: (x: number, y: number, dist: number) => void,
): void {
  const visitedEdges = new Set<string>([start.id]);
  const p0 = start.polyline[startIndex];
  if (p0) visit(p0.x, p0.y, startDist);

  const stack: { edge: RoadEdge; index: number; dist: number; dir: 1 | -1 }[] = [
    { edge: start, index: startIndex, dist: startDist, dir: 1 },
    { edge: start, index: startIndex, dist: startDist, dir: -1 },
  ];

  while (stack.length > 0) {
    const item = stack.pop()!;
    const { edge } = item;
    let { index: i, dist } = item;
    const { dir } = item;
    i += dir;
    while (i >= 0 && i < edge.polyline.length && dist < reach) {
      const prev = edge.polyline[i - dir];
      const cur = edge.polyline[i];
      dist += Math.hypot(cur.x - prev.x, cur.y - prev.y);
      if (dist >= reach) break;
      visit(cur.x, cur.y, dist);
      i += dir;
    }
    if (dist >= reach) continue;
    // Reached this edge's end within budget — cross into every edge sharing that node.
    const endNodeId = dir === 1 ? edge.b : edge.a;
    for (const next of edgesByNode.get(endNodeId) ?? []) {
      if (visitedEdges.has(next.id)) continue;
      visitedEdges.add(next.id);
      const enterFromA = next.a === endNodeId;
      const enterIndex = enterFromA ? 0 : next.polyline.length - 1;
      const p = next.polyline[enterIndex];
      if (p) visit(p.x, p.y, dist);
      stack.push({ edge: next, index: enterIndex, dist, dir: enterFromA ? 1 : -1 });
    }
  }
}

const NEIGHBOUR_4 = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

/**
 * Deposit the doorstep→graph gravel apron for every building of every settlement plan.
 * No-op (returns zero stats, no tile writes, no `tilesRev` bump) on a peopleless world
 * (no plans/buildings) or a world with no road graph. Call AFTER the road graph is final
 * (fillet reconciliation included) and after settlement wear's own prewarm, so a doorstep
 * already promoted to `dirt` composes with the gravel radiating past it.
 */
export function depositDoorstepGravel(
  map: GameMap, plans: SettlementPlan[], world: World, seed: number,
): { buildings: number; cells: number } {
  const stats = { buildings: 0, cells: 0 };
  const graph = map.roadGraph;
  if (!graph || graph.edges.length === 0 || plans.length === 0) return stats;

  const edgesByNode = new Map<string, RoadEdge[]>();
  for (const e of graph.edges) {
    (edgesByNode.get(e.a) ?? edgesByNode.set(e.a, []).get(e.a)!).push(e);
    if (e.b !== e.a) (edgesByNode.get(e.b) ?? edgesByNode.set(e.b, []).get(e.b)!).push(e);
  }
  const polylineIndex = buildPolylineIndex(graph);

  // One pass over the whole registry (not one pass PER settlement plan) grouping buildings by
  // owning poiId — `world.registry.all()` returns every entity (flora, rocks, NPCs, buildings
  // alike), so re-filtering it per plan is O(plans × totalEntities) for no reason.
  const buildingsByPoi = new Map<string, Entity[]>();
  for (const e of world.registry.all()) {
    if (!isBuilding(e)) continue;
    const poiId = (e.properties as { poiId?: string } | undefined)?.poiId;
    if (!poiId) continue;
    const list = buildingsByPoi.get(poiId);
    if (list) list.push(e);
    else buildingsByPoi.set(poiId, [e]);
  }

  const scores = new Map<string, number>();

  for (const plan of plans) {
    if (!plan.poiId) continue;
    const owned = buildingsByPoi.get(plan.poiId);
    if (!owned || owned.length === 0) continue;
    owned.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)); // deterministic, order harmless anyway (max-agg)

    for (const e of owned) {
      const door = mainDoorAnchor(e);
      if (!door) continue; // no threshold to radiate from (a well/graveyard — perimeter wear is settlement-wear's job)
      const step = doorstepTile(door);
      const busy = isBusyKind(e.kind);
      const reach = busy ? BUSY_REACH : ORDINARY_REACH;
      const strength = busy ? BUSY_STRENGTH : ORDINARY_STRENGTH;

      const snap = nearestGraphPoint(polylineIndex, step.x, step.y, reach + SNAP_SLACK);
      if (!snap) continue; // not connected to the road graph within reach — no apron, by design

      stats.buildings++;

      // Doorstep core (distance 0) + its 4-neighbours (distance 1) — the immediate
      // threshold apron, before the graph walk even starts.
      bump(scores, step.x, step.y, falloff(0, reach, strength));
      for (const [dx, dy] of NEIGHBOUR_4) bump(scores, step.x + dx, step.y + dy, falloff(1, reach, strength));

      walkGraphOutward(edgesByNode, snap.edge, snap.index, snap.dist, reach, (x, y, dist) => {
        const rx = Math.round(x), ry = Math.round(y);
        const s = falloff(dist, reach, strength);
        bump(scores, rx, ry, s);
        for (const [dx, dy] of NEIGHBOUR_4) bump(scores, rx + dx, ry + dy, s * STRADDLE_MULT);
      });
    }
  }

  if (scores.size === 0) return stats;

  let changed = false;
  for (const [key, score] of scores) {
    const comma = key.indexOf(',');
    const x = Number(key.slice(0, comma)), y = Number(key.slice(comma + 1));
    const t = map.tiles[y]?.[x];
    if (!t || t.walkable === false) continue;         // buildings / blocked cells
    if (!GRAVEL_ELIGIBLE.has(t.type)) continue;        // roads/bridges/water/lots/farm fields excluded by omission
    if (t.type === 'gravel') continue;                 // already gravel — no rewrite, no double-count
    const jitter = (noise(x, y, seed + 8161) - 0.5) * JITTER_AMPLITUDE;
    if (score < PROMOTE_THRESHOLD + jitter) continue;
    t.type = 'gravel';
    stats.cells++;
    changed = true;
  }
  if (changed) bumpTilesRev(map);
  return stats;
}
