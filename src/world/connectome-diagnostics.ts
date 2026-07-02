// src/world/connectome-diagnostics.ts
//
// The connectome LINTER. A pure, deterministic pass over the generated world that
// reports rule violations, smells, and pressure points as structured `Diagnostic`s —
// the way a compiler reports errors/warnings against code. The output is consumed by:
//   1. agents (Fate / a CLI / the MCP `lint_world` tool) — apply a `suggestedFix`
//      verb, re-lint, converge (the lint → fix → re-lint loop);
//   2. a STUDIO overlay that paints each diagnostic's `locus` by severity;
//   3. CI — the same rules back the integration invariants, so runtime and tests
//      can't drift (e.g. `building.overlap` IS `settlement-spatial-invariants` INV1).
//
// Rules are independent and registered in DEFAULT_RULES; evaluateConnectome runs them
// and returns a graded report. Everything here is `Math.random`-free and reads only
// committed world state, so the report is reproducible for a given world.

import type { GameMap, Entity } from '@/core/types';
import type { World } from '@/world/world';
import { blueprintOf } from '@/blueprint/entity';
import { WATER_TYPES } from '@/core/constants';
import type { RoadEdge } from '@/world/road-graph';
import { barrierFootprintTiles, type PlacedBarrier, type BarrierRun, type BarrierGate } from '@/world/barrier';
import { getWorldDeformationStore } from '@/world/road-deformation';
import { heightAt, baseHeightAt, type DeformationStore } from '@/world/terrain-deformation';

export type DiagnosticSeverity = 'error' | 'warn' | 'info';

/** WHERE a diagnostic lives, so it can be painted and routed to a fix. */
export interface DiagnosticLocus {
  edges?: string[];            // road-graph edge ids
  nodes?: string[];            // road-graph node ids
  entities?: string[];         // entity ids (buildings, barriers)
  pois?: string[];             // POI ids
  tiles?: { x: number; y: number }[];
}

export interface Diagnostic {
  rule: string;
  severity: DiagnosticSeverity;
  message: string;
  locus: DiagnosticLocus;
  /** Quantified evidence (width=5.4, budget=3.2, degree=6 …) for ranking + fixes. */
  metrics?: Record<string, number>;
  /** The verb an agent can apply to resolve it (the loop's hook into command-verbs). */
  suggestedFix?: { verb: string; args: Record<string, unknown> };
}

export interface DiagnosticContext {
  world: World;
  map: GameMap;
}

export interface DiagnosticRule {
  id: string;
  severity: DiagnosticSeverity;
  description: string;
  evaluate(ctx: DiagnosticContext): Diagnostic[];
}

export interface DiagnosticReport {
  total: number;
  counts: Record<DiagnosticSeverity, number>;
  byRule: Record<string, number>;
  diagnostics: Diagnostic[];
}

// ── Shared derivations (small worlds; recomputed per-rule is microseconds) ─────────

const cellKey = (x: number, y: number): string => `${x},${y}`;

/** Absolute SOLID (wall) cells of every building, keyed by entity id. Door/lawn cells
 *  are the passable interface (a road to the door is correct), so they're excluded —
 *  this matches `tileBlockedByBuilding` and `settlement-spatial-invariants`. */
export function buildingStructureCells(world: World): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const e of world.query({ tag: 'building' }) as Entity[]) {
    const bp = blueprintOf(e);
    if (!bp) continue;
    const ox = Math.floor(e.x), oy = Math.floor(e.y);
    const doors = new Set(bp.collision.doorCells);
    const cells = new Set<string>();
    for (const local of bp.collision.blocked) {
      if (doors.has(local)) continue;
      const ci = local.indexOf(',');
      const lx = Number(local.slice(0, ci)), ly = Number(local.slice(ci + 1));
      cells.add(cellKey(ox + lx, oy + ly));
    }
    out.set(String(e.id), cells);
  }
  return out;
}

/** Absolute blocking cells of every placed barrier run (croft/settlement rings). */
function barrierCellsByEntity(world: World): Map<string, [number, number][]> {
  const out = new Map<string, [number, number][]>();
  for (const e of world.query({ tag: 'barrier' }) as Entity[]) {
    const fc = (e.properties as { footprintCells?: [number, number][] } | undefined)?.footprintCells;
    if (Array.isArray(fc)) out.set(String(e.id), fc);
  }
  return out;
}

const ROAD_TILE_TYPES = new Set(['dirt_road', 'stone_road', 'bridge']);

/** Set of road-carrying tile cells from the derived tile mask. */
function roadTileCells(map: GameMap): Set<string> {
  const out = new Set<string>();
  const tiles = map.tiles;
  for (let y = 0; y < tiles.length; y++) {
    const row = tiles[y];
    for (let x = 0; x < row.length; x++) {
      if (ROAD_TILE_TYPES.has(row[x]?.type)) out.add(cellKey(x, y));
    }
  }
  return out;
}

const tilesOf = (cells: Iterable<string>): { x: number; y: number }[] => {
  const out: { x: number; y: number }[] = [];
  for (const c of cells) { const i = c.indexOf(','); out.push({ x: +c.slice(0, i), y: +c.slice(i + 1) }); }
  return out;
};

// ── Rules ─────────────────────────────────────────────────────────────────────────

/** ERROR — two buildings claim the same solid cell (= spatial-invariants INV1). */
const buildingOverlap: DiagnosticRule = {
  id: 'building.overlap',
  severity: 'error',
  description: 'Two building footprints occupy the same solid cell.',
  evaluate(ctx) {
    const struct = buildingStructureCells(ctx.world);
    const owner = new Map<string, string>();
    const pairCells = new Map<string, Set<string>>(); // "idA|idB" → shared cells
    for (const [id, cells] of struct) {
      for (const c of cells) {
        const prev = owner.get(c);
        if (prev && prev !== id) {
          const k = prev < id ? `${prev}|${id}` : `${id}|${prev}`;
          (pairCells.get(k) ?? pairCells.set(k, new Set()).get(k)!).add(c);
        } else owner.set(c, id);
      }
    }
    return [...pairCells.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([k, cells]) => {
      const [a, b] = k.split('|');
      return {
        rule: this.id, severity: this.severity,
        message: `buildings ${a} and ${b} overlap on ${cells.size} solid cell(s)`,
        locus: { entities: [a, b], tiles: tilesOf(cells) },
        metrics: { cells: cells.size },
      };
    });
  },
};

/** ERROR — a barrier (wall/fence/hedge) blocking cell sits on a building (INV2). */
const barrierThroughBuilding: DiagnosticRule = {
  id: 'barrier.through-building',
  severity: 'error',
  description: 'A barrier run passes through a building footprint.',
  evaluate(ctx) {
    const struct = buildingStructureCells(ctx.world);
    const solid = new Set<string>();
    for (const cells of struct.values()) for (const c of cells) solid.add(c);
    const out: Diagnostic[] = [];
    for (const [id, fc] of barrierCellsByEntity(ctx.world)) {
      const hits = fc.filter(([x, y]) => solid.has(cellKey(x, y)));
      if (hits.length) out.push({
        rule: this.id, severity: this.severity,
        message: `barrier ${id} crosses a building on ${hits.length} cell(s)`,
        locus: { entities: [id], tiles: hits.map(([x, y]) => ({ x, y })) },
        metrics: { cells: hits.length },
      });
    }
    return out.sort((a, b) => a.locus.entities![0].localeCompare(b.locus.entities![0]));
  },
};

/** Map a path distance `t` (tiles) to a world point along the polyline. Local dup of
 *  `barrier.ts`'s private `pointAt` — this file reads geometry, it doesn't own it. */
function barrierPointAt(path: [number, number][], t: number): [number, number] {
  let acc = 0;
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1], [bx, by] = path[i];
    const len = Math.hypot(bx - ax, by - ay);
    if (t <= acc + len) { const u = (t - acc) / (len || 1); return [ax + (bx - ax) * u, ay + (by - ay) * u]; }
    acc += len;
  }
  return path[path.length - 1];
}
function barrierPathLength(path: [number, number][]): number {
  let s = 0;
  for (let i = 1; i < path.length; i++) s += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
  return s;
}

/** Arc-length step (tiles) for dense wet-arc scanning along a barrier polyline — fine
 *  enough to catch a wet stretch the coarse 0.34-tile cell rasterizer (`barrierFootprintTiles`)
 *  can straddle between two sampled cells (a live probe found 6 such wet samples on
 *  `oakshire_ring` the cell rule missed entirely). */
const DENSE_WET_SAMPLE_STEP = 0.5;

/** Is arc-length `t` inside a declared opening — gate (road crossing) or gap (water/building
 *  interface)? Either is a real, designed opening in the line; only an UNDECLARED wet stretch
 *  is the bug. */
function withinGateSpan(t: number, gates: BarrierGate[]): boolean {
  return gates.some((g) => t >= g.t - g.width / 2 && t <= g.t + g.width / 2);
}

interface WetArcSpan { tStart: number; tEnd: number; tiles: { x: number; y: number }[] }

/** Dense-sample a barrier's polyline at `DENSE_WET_SAMPLE_STEP` and cluster contiguous
 *  UNDECLARED wet arc-length runs into spans (start/end t + the tiles sampled along it). */
function denseWetArcSpans(run: BarrierRun, tiles: GameMap['tiles']): WetArcSpan[] {
  const total = barrierPathLength(run.path);
  const spans: WetArcSpan[] = [];
  let cur: { tStart: number; tEnd: number; cells: Map<string, [number, number]> } | null = null;
  const flush = (): void => {
    if (cur) spans.push({ tStart: cur.tStart, tEnd: cur.tEnd, tiles: [...cur.cells.values()].map(([x, y]) => ({ x, y })) });
    cur = null;
  };
  for (let t = 0; t <= total + 1e-9; t += DENSE_WET_SAMPLE_STEP) {
    const tt = Math.min(t, total);
    const [px, py] = barrierPointAt(run.path, tt);
    const cx = Math.round(px), cy = Math.round(py);
    const wet = !withinGateSpan(tt, run.gates) && WATER_TYPES.has(tiles[cy]?.[cx]?.type ?? '');
    if (wet) {
      if (!cur) cur = { tStart: tt, tEnd: tt, cells: new Map() };
      cur.tEnd = tt;
      cur.cells.set(cellKey(cx, cy), [cx, cy]);
    } else {
      flush();
    }
  }
  flush();
  return spans;
}

/** ERROR — a barrier blocking cell stands in open water. Walls/hedges must open (gap)
 *  over a channel, not wade it: the enclosure derivation gates every wet stretch, so a
 *  hit here means a ring geometry change regressed the water guard.
 *
 *  Two independent checks, both kept: (1) the rasterized blocking-cell footprint (as
 *  before — catches a whole wet cell the geometry claims), and (2) DENSE polyline
 *  sampling of `map.barrierRuns` at ≤0.5-tile steps (A1) — the rasterizer steps at 0.34
 *  tiles per cell and can still straddle a narrow wet stretch between two sampled cells;
 *  dense sampling walks the actual line and reports the wet ARC SPAN (t-range + tiles),
 *  which the cell check can't express. A sample inside a declared gate/gap span is not a
 *  violation — that's the opening doing its job. */
const barrierOverWater: DiagnosticRule = {
  id: 'barrier.over-water',
  severity: 'error',
  description: 'A barrier run stands in open water instead of opening over it.',
  evaluate(ctx) {
    const tiles = ctx.map.tiles;
    const out: Diagnostic[] = [];
    for (const [id, fc] of barrierCellsByEntity(ctx.world)) {
      const hits = fc.filter(([x, y]) => WATER_TYPES.has(tiles[y]?.[x]?.type ?? ''));
      if (hits.length) out.push({
        rule: this.id, severity: this.severity,
        message: `barrier ${id} stands in water on ${hits.length} cell(s)`,
        locus: { entities: [id], tiles: hits.map(([x, y]) => ({ x, y })) },
        metrics: { cells: hits.length },
      });
    }
    for (const { id, run } of ctx.map.barrierRuns ?? []) {
      if (!run.path || run.path.length < 2) continue;
      for (const span of denseWetArcSpans(run, tiles)) {
        out.push({
          rule: this.id, severity: this.severity,
          message: `barrier ${id} polyline runs through open water from t=${span.tStart.toFixed(2)} to t=${span.tEnd.toFixed(2)} (${span.tiles.length} tile(s)) with no gate/gap declared`,
          locus: { entities: [id], tiles: span.tiles.slice(0, 24) },
          metrics: { tStart: Math.round(span.tStart * 100) / 100, tEnd: Math.round(span.tEnd * 100) / 100, cells: span.tiles.length },
        });
      }
    }
    return out.sort((a, b) => a.locus.entities![0].localeCompare(b.locus.entities![0]));
  },
};

/** ERROR — a road tile sits on a building solid cell (INV3). */
const roadThroughBuilding: DiagnosticRule = {
  id: 'road.through-building',
  severity: 'error',
  description: 'A road carves through a building footprint.',
  evaluate(ctx) {
    const roads = roadTileCells(ctx.map);
    const out: Diagnostic[] = [];
    for (const [id, cells] of buildingStructureCells(ctx.world)) {
      const hits = [...cells].filter((c) => roads.has(c));
      if (hits.length) out.push({
        rule: this.id, severity: this.severity,
        message: `road tiles cross building ${id} on ${hits.length} cell(s)`,
        locus: { entities: [id], tiles: tilesOf(hits) },
        metrics: { cells: hits.length },
      });
    }
    return out.sort((a, b) => a.locus.entities![0].localeCompare(b.locus.entities![0]));
  },
};

/** Unordered endpoint key for a road edge, preferring POI refs so the same two PLACES
 *  collapse even through different waypoint nodes. */
function edgePairKey(edge: RoadEdge, poiOf: Map<string, string | undefined>): string {
  const a = poiOf.get(edge.a) ?? edge.a, b = poiOf.get(edge.b) ?? edge.b;
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** WARN — more than one road edge connects the same pair of places (church↔tavern). */
const redundantParallelRoad: DiagnosticRule = {
  id: 'road.redundant-parallel',
  severity: 'warn',
  description: 'Multiple road edges run between the same two places; they should merge.',
  evaluate(ctx) {
    const g = ctx.map.roadGraph;
    if (!g) return [];
    const poiOf = new Map<string, string | undefined>(g.nodes.map((n) => [n.id, n.poiRef]));
    const byPair = new Map<string, RoadEdge[]>();
    for (const e of g.edges) {
      if (e.feature !== 'road') continue;
      const k = edgePairKey(e, poiOf);
      (byPair.get(k) ?? byPair.set(k, []).get(k)!).push(e);
    }
    return [...byPair.entries()].filter(([, es]) => es.length > 1)
      .sort((a, b) => a[0].localeCompare(b[0])).map(([k, es]) => {
        const [a, b] = k.split('|');
        return {
          rule: this.id, severity: this.severity,
          message: `${es.length} parallel roads between ${a} and ${b} — merge into one`,
          locus: { edges: es.map((e) => e.id), pois: [a, b].filter((x) => x.includes(':')) },
          metrics: { count: es.length },
          suggestedFix: { verb: 'merge_roads', args: { edges: es.map((e) => e.id) } },
        };
      });
  },
};

/** INFO — a junction with an unusually high road degree (a pressure point). */
const oversubscribedJunction: DiagnosticRule = {
  id: 'junction.oversubscribed',
  severity: 'info',
  description: 'A node carries an unusually high number of road edges (pressure point).',
  evaluate(ctx) {
    const g = ctx.map.roadGraph;
    if (!g) return [];
    const DEGREE_BUDGET = 5;
    const deg = new Map<string, number>();
    for (const e of g.edges) {
      if (e.feature !== 'road') continue;
      deg.set(e.a, (deg.get(e.a) ?? 0) + 1);
      deg.set(e.b, (deg.get(e.b) ?? 0) + 1);
    }
    return [...deg.entries()].filter(([, d]) => d > DEGREE_BUDGET)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([id, d]) => ({
        rule: this.id, severity: this.severity,
        message: `junction ${id} carries ${d} roads (budget ${DEGREE_BUDGET})`,
        locus: { nodes: [id] },
        metrics: { degree: d, budget: DEGREE_BUDGET },
      }));
  },
};

/** Min distance from point (px,py) to the segment [a,b]. */
function distToSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  if (l2 === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / l2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
/** Min distance from a point to a polyline. */
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

const PARALLEL_PROXIMITY_TILES = 2.5;     // within this, two roads "run together"
const PARALLEL_MIN_SHARED_TILES = 6;      // a shared corridor must span at least this far
const PARALLEL_MIN_SHARED_FRACTION = 0.5; // …and cover ≥ half the SHORTER road

/** WARN — two DIFFERENT-endpoint roads run near-parallel for a long stretch (a route-level
 *  duplicate corridor the same-endpoint `road.redundant-parallel` rule can't see). This is the
 *  detection half of the "merge parallel roads" work (#26): it surfaces the corridor in the
 *  studio overlay / `lint_world` so the (connectivity-preserving) merge can target it. Pure
 *  geometry, no worldgen change. */
const parallelCorridorRoad: DiagnosticRule = {
  id: 'road.parallel-corridor',
  severity: 'warn',
  description: 'Two roads with different endpoints run near-parallel for a long stretch — a wasteful duplicate corridor.',
  evaluate(ctx) {
    const g = ctx.map.roadGraph;
    if (!g) return [];
    const roads = g.edges.filter((e) => e.feature === 'road' && e.polyline.length >= 2);
    const out: Diagnostic[] = [];
    for (let i = 0; i < roads.length; i++) {
      for (let j = i + 1; j < roads.length; j++) {
        const e1 = roads[i], e2 = roads[j];
        // Shared run = length of e1 whose segment midpoints lie within proximity of e2.
        let shared = 0;
        for (let k = 0; k + 1 < e1.polyline.length; k++) {
          const a = e1.polyline[k], b = e1.polyline[k + 1];
          const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
          if (distToPolyline(mx, my, e2.polyline) <= PARALLEL_PROXIMITY_TILES) shared += Math.hypot(b.x - a.x, b.y - a.y);
        }
        const minLen = Math.min(polylineLength(e1.polyline), polylineLength(e2.polyline)) || 1;
        if (shared >= PARALLEL_MIN_SHARED_TILES && shared >= PARALLEL_MIN_SHARED_FRACTION * minLen) {
          out.push({
            rule: this.id, severity: this.severity,
            message: `roads ${e1.id} and ${e2.id} run together for ~${Math.round(shared)} tiles — consider merging into one corridor`,
            locus: { edges: [e1.id, e2.id] },
            metrics: { sharedTiles: Math.round(shared * 10) / 10 },
            suggestedFix: { verb: 'merge_roads', args: { edges: [e1.id, e2.id] } },
          });
        }
      }
    }
    return out.sort((a, b) => (b.metrics?.sharedTiles ?? 0) - (a.metrics?.sharedTiles ?? 0));
  },
};

/** ERROR — a building's structure stands on a water tile (river/lake/ocean). A guard for the
 *  "buildings go on land" invariant, the wet-site analogue of `road.through-building`: 0 in a
 *  healthy world (the placer avoids water), but it CATCHES a regression that would otherwise
 *  ship a house in a river. Pure read. */
const buildingOnWater: DiagnosticRule = {
  id: 'building.on-water',
  severity: 'error',
  description: 'A building occupies a water tile — it should be sited on land.',
  evaluate(ctx) {
    const tiles = ctx.map.tiles;
    const out: Diagnostic[] = [];
    for (const [id, set] of buildingStructureCells(ctx.world)) {
      const wet: { x: number; y: number }[] = [];
      for (const key of set) {
        const ci = key.indexOf(',');
        const x = Number(key.slice(0, ci)), y = Number(key.slice(ci + 1));
        if (WATER_TYPES.has(tiles[y]?.[x]?.type ?? '')) wet.push({ x, y });
      }
      if (wet.length) out.push({
        rule: this.id, severity: this.severity,
        message: `building ${id} occupies ${wet.length} water tile${wet.length > 1 ? 's' : ''}`,
        locus: { entities: [id], tiles: wet },
        metrics: { wetCells: wet.length },
      });
    }
    return out.sort((a, b) => (a.locus.entities?.[0] ?? '').localeCompare(b.locus.entities?.[0] ?? ''));
  },
};

/** ERROR — a plain road tile OVERWROTE water: its preserved `baseType` is a water type but
 *  its type is dirt/stone road, not `bridge` — a BRIDGELESS FORD. This is exact, not a
 *  proximity heuristic (a causeway on a dry spit between two banks is legitimate): every
 *  road stamp records what it covered via `preserveBaseType`, so a ford is precisely a
 *  road whose underlay is water. Caught in the wild: a second road reusing an earlier
 *  road's crossing used to stamp the shared bridge deck back to dirt (applyEdge). */
const roadFordsWater: DiagnosticRule = {
  id: 'road.on-water',
  severity: 'error',
  description: 'A road tile overwrote open water without a bridge (bridgeless ford).',
  evaluate(ctx) {
    const { tiles, width, height } = ctx.map;
    const hits: { x: number; y: number }[] = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const t = tiles[y]?.[x];
        if (!t || (t.type !== 'dirt_road' && t.type !== 'stone_road')) continue;
        if (t.baseType && WATER_TYPES.has(t.baseType)) hits.push({ x, y });
      }
    }
    if (!hits.length) return [];
    return [{
      rule: this.id, severity: this.severity,
      message: `road tiles ford open water at ${hits.length} cell(s) with no bridge`,
      locus: { tiles: hits.slice(0, 24) },
      metrics: { cells: hits.length },
    }];
  },
};

// ── Bridge / crossing rules ─────────────────────────────────────────────────────────
//
// A road×water crossing is represented TWICE today: as `bridge` TILES (the rendered
// deck's footprint on the tile raster) and as `bridge_deck` ENTITIES (the grey-massing
// structure — deck riding its bank elevation, piers reaching the bed). Nothing enforces
// the two agree, so a geometry regression can silently produce a floating deck, a deck
// that never reaches its bank, or a bridge tile with no superstructure over it. These
// rules read both representations and cross-check them.

/** A `bridge_deck` entity's placement, reduced to what these rules need: its AABB
 *  footprint (origin + `blueprint.rb.footprint`, per the plan's own vocabulary) and its
 *  two SPAN-AXIS end points — the bank-seating ends — derived from the deck part's real
 *  yaw + length (not the AABB corners, which for a diagonal deck are corners of the
 *  bounding square, not the slab's actual ends). Falls back to the AABB's own corners
 *  when a deck lacks a `deck` part (never happens for `buildCrossingSpanEntities`
 *  output, but keeps this pure against any future producer). */
interface DeckFootprint {
  id: string;
  x0: number; y0: number; w: number; h: number;
  /** The two footprint-native "ends" along the deck's long axis — the LEFT/RIGHT
   *  columns for a horizontal-dominant deck, TOP/BOTTOM rows for a vertical-dominant
   *  one. Deliberately kept to whole grid columns/rows of the AABB the deck actually
   *  claims (never a point reconstructed off-grid from yaw+length): an early version
   *  re-derived a single continuous endpoint from the deck's PADDED length (spanTiles+1,
   *  see `crossing-structures.ts`'s `deckEntity`) and rounded it to a tile — on a
   *  cardinal-axis deck whose fractional midpoint lands near a half-tile boundary this
   *  routinely rounds to a cell one tile off the AABB, which a live probe showed
   *  flagging 5/5 real crossings as "unseated" purely from rounding, not a real defect.
   *  Whole-edge cells sidestep that: they're always exactly the deck's own claimed
   *  ground, so a false positive would mean the deck's OWN footprint edge is wet. */
  edgeA: [number, number][];
  edgeB: [number, number][];
}

function bridgeDeckFootprints(world: World): DeckFootprint[] {
  const out: DeckFootprint[] = [];
  for (const e of world.query({ kind: 'bridge_deck' }) as Entity[]) {
    const rb = (e.properties as {
      blueprint?: { rb?: { footprint?: { w: number; h: number }; parts?: Array<{ type: string; params?: Record<string, unknown> }> } };
    } | undefined)?.blueprint?.rb;
    const fp = rb?.footprint;
    if (!fp) continue;
    const ox = Math.floor(e.x), oy = Math.floor(e.y);
    // Long axis from the deck part's yaw when available (breaks the tie on a
    // near-square AABB, e.g. a padded short span whose w and h coincide); otherwise
    // whichever footprint dimension is larger.
    const deckPart = rb?.parts?.find((p) => p.type === 'deck');
    const yawDeg = Number(deckPart?.params?.yawDeg);
    const rad = Number.isFinite(yawDeg) ? (yawDeg * Math.PI) / 180 : (fp.w >= fp.h ? 0 : Math.PI / 2);
    const vertical = Math.abs(Math.sin(rad)) > Math.abs(Math.cos(rad));
    const edgeA: [number, number][] = [];
    const edgeB: [number, number][] = [];
    if (vertical) {
      for (let dx = 0; dx < fp.w; dx++) { edgeA.push([ox + dx, oy]); edgeB.push([ox + dx, oy + fp.h - 1]); }
    } else {
      for (let dy = 0; dy < fp.h; dy++) { edgeA.push([ox, oy + dy]); edgeB.push([ox + fp.w - 1, oy + dy]); }
    }
    out.push({ id: String(e.id), x0: ox, y0: oy, w: fp.w, h: fp.h, edgeA, edgeB });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/** Metres of carve depth that counts as a "channel" for the beneath-the-deck seating
 *  check — well below the smallest authored river carve (~1 m, see content-version
 *  notes) but comfortably above heightfield noise, so a channel the water tiles haven't
 *  (yet) classified as literal water still reads as a legitimate crossing target. */
const CARVED_CHANNEL_MIN_DEPTH_M = 0.4;

/** A tile is a valid "under the bridge" surface — open water, or a carved channel that
 *  hasn't (or shouldn't) become a water tile (e.g. a dry ford channel). */
function isWetOrCarved(map: GameMap, store: DeformationStore, x: number, y: number): boolean {
  const t = map.tiles[y]?.[x];
  if (t && WATER_TYPES.has(t.type)) return true;
  return baseHeightAt(map, x, y) - heightAt(map, store, x, y) >= CARVED_CHANNEL_MIN_DEPTH_M;
}

/** ERROR — a bridge deck doesn't actually seat on its crossing: nothing beneath its
 *  footprint is water/channel (a deck floating over dry ground — a siting or elevation
 *  bug), or one of its two span-axis ENDS (where the deck should meet its bank
 *  abutment) is ENTIRELY open water (the whole edge stops short of the bank — a real
 *  riverbank cutting diagonally across one cell of an end edge is normal and not
 *  flagged; every cell of that edge being water is not). */
const bridgeSeating: DiagnosticRule = {
  id: 'bridge.seating',
  severity: 'error',
  description: 'A bridge deck does not seat correctly on its crossing (floating span or unseated end).',
  evaluate(ctx) {
    const decks = bridgeDeckFootprints(ctx.world);
    if (!decks.length) return [];   // skip building the deformation store when there's nothing to check
    const store = getWorldDeformationStore(ctx.map);
    const out: Diagnostic[] = [];
    for (const deck of decks) {
      const cells: [number, number][] = [];
      for (let dy = 0; dy < deck.h; dy++) for (let dx = 0; dx < deck.w; dx++) cells.push([deck.x0 + dx, deck.y0 + dy]);
      if (!cells.some(([x, y]) => isWetOrCarved(ctx.map, store, x, y))) {
        out.push({
          rule: this.id, severity: this.severity,
          message: `bridge deck ${deck.id} has no water/channel beneath its ${cells.length}-cell footprint — a floating span`,
          locus: { entities: [deck.id], tiles: cells.slice(0, 24).map(([x, y]) => ({ x, y })) },
          metrics: { cells: cells.length },
        });
      }
      const isWet = ([x, y]: [number, number]): boolean => WATER_TYPES.has(ctx.map.tiles[y]?.[x]?.type ?? '');
      const badEnds = [deck.edgeA, deck.edgeB].filter((edge) => edge.length > 0 && edge.every(isWet));
      if (badEnds.length) out.push({
        rule: this.id, severity: this.severity,
        message: `bridge deck ${deck.id} has ${badEnds.length} span end(s) entirely in open water — an unseated abutment`,
        locus: { entities: [deck.id], tiles: badEnds.flat().map(([x, y]) => ({ x, y })) },
        metrics: { unseatedEnds: badEnds.length },
      });
    }
    return out.sort((a, b) => a.locus.entities![0].localeCompare(b.locus.entities![0]));
  },
};

/** Contiguous 4-connected runs of `bridge`-typed tiles, as cell lists. */
function bridgeTileRuns(map: GameMap): [number, number][][] {
  const { tiles, width, height } = map;
  const seen = new Set<string>();
  const runs: [number, number][][] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (tiles[y]?.[x]?.type !== 'bridge' || seen.has(cellKey(x, y))) continue;
      const run: [number, number][] = [];
      const stack: [number, number][] = [[x, y]];
      seen.add(cellKey(x, y));
      while (stack.length) {
        const [cx, cy] = stack.pop()!;
        run.push([cx, cy]);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as [number, number][]) {
          const nx = cx + dx, ny = cy + dy, nk = cellKey(nx, ny);
          if (!seen.has(nk) && tiles[ny]?.[nx]?.type === 'bridge') { seen.add(nk); stack.push([nx, ny]); }
        }
      }
      runs.push(run);
    }
  }
  return runs;
}

/** ERROR — `bridge` tiles and `bridge_deck` entities disagree on where a crossing is:
 *  tiles must intersect a deck footprint (else it's un-bridged tiles — the tiles-side of
 *  the "unbridging" class the terrain-features epic fixed the other direction of), and a
 *  deck must sit over ≥1 bridge tile (else it's a deck over plain ground/water with no
 *  carved crossing beneath it — the tile-side never got stamped). */
const bridgeTilesVsDeck: DiagnosticRule = {
  id: 'bridge.tiles-vs-deck',
  severity: 'error',
  description: 'Bridge tiles and bridge_deck entities must agree on where a crossing is.',
  evaluate(ctx) {
    const decks = bridgeDeckFootprints(ctx.world).map((d) => {
      const cells = new Set<string>();
      for (let dy = 0; dy < d.h; dy++) for (let dx = 0; dx < d.w; dx++) cells.add(cellKey(d.x0 + dx, d.y0 + dy));
      return { id: d.id, cells };
    });
    const out: Diagnostic[] = [];
    for (const run of bridgeTileRuns(ctx.map)) {
      const covered = decks.some((d) => run.some(([x, y]) => d.cells.has(cellKey(x, y))));
      if (covered) continue;
      const [cx, cy] = run[Math.floor(run.length / 2)];
      out.push({
        rule: this.id, severity: this.severity,
        message: `bridge tile run of ${run.length} cell(s) near (${cx},${cy}) has no bridge_deck entity over it`,
        locus: { tiles: run.slice(0, 24).map(([x, y]) => ({ x, y })) },
        metrics: { cells: run.length },
      });
    }
    for (const d of decks) {
      const hasTile = [...d.cells].some((k) => {
        const ci = k.indexOf(','); const x = Number(k.slice(0, ci)), y = Number(k.slice(ci + 1));
        return ctx.map.tiles[y]?.[x]?.type === 'bridge';
      });
      if (hasTile) continue;
      out.push({
        rule: this.id, severity: this.severity,
        message: `bridge deck ${d.id} sits over no bridge tile`,
        locus: { entities: [d.id] },
        metrics: { cells: d.cells.size },
      });
    }
    return out.sort((a, b) => {
      const ak = a.locus.entities?.[0] ?? `tile:${a.locus.tiles![0].y}:${a.locus.tiles![0].x}`;
      const bk = b.locus.entities?.[0] ?? `tile:${b.locus.tiles![0].y}:${b.locus.tiles![0].x}`;
      return ak.localeCompare(bk);
    });
  },
};

/** Metres of carve depth below which a hollow doesn't read as the "dark faceted pit"
 *  render artifact — shallow grade cuts (road shoulders, gentle levee tapers) are
 *  expected terrain sculpting, not a smell. */
const DRY_PIT_MIN_DEPTH_M = 1.2;

/** Isolation search radius (tiles) for the dry-pit rule below. A river's bank taper is a
 *  legitimate, INTENDED carve that reaches well past the single tile the hydrology pass
 *  classified as `river` — `river-deformation.ts`'s `BANK_FEATHER_MAX_TILES` alone is 3.0
 *  tiles (deep reaches feather wider so the valley wall always contains the bed), on top
 *  of the channel's own half-width. A live probe against the default world's two seeds
 *  found EVERY initial hit (checked at a 1-tile radius) sourced to `river:incision` — the
 *  ordinary feathered shoulder of a real, correctly-placed river the tile classifier
 *  simply didn't paint that far out (a second, independent read of the SAME "hydrology
 *  runs twice" divergence this codebase already tracks). Widening to cover the max bank
 *  feather (+1 tile margin) cleared every one of those without hiding a genuinely
 *  isolated pit — nothing in this world's earthworks (there are none) or road cuts needs
 *  more than a couple of tiles of clearance either. */
const DRY_PIT_ISOLATION_RADIUS_TILES = 4;

/** WARN — a carved hollow (an earthwork ditch, a stray/orphaned channel deformation)
 *  with nothing living in it: no water, no road, no bridge anywhere near it. In the
 *  render this is the dark faceted pit — a hole cut into the terrain that never got a
 *  reason to exist (a ditch whose ring drifted off its motte, a channel deformation left
 *  behind by a removed river reach) — NOT the ordinary feathered bank of a real river or
 *  road cut, which is why the isolation check reaches `DRY_PIT_ISOLATION_RADIUS_TILES`
 *  tiles rather than just the adjacent ring. Depth is measured PURELY from the shared
 *  deformation channel: `baseHeightAt` (seed terrain, no deformations) minus `heightAt`
 *  composed over the SAME store the renderer/collision read (`getWorldDeformationStore`)
 *  — both already in metres, so no unit conversion or heightfield-reconstruction is
 *  needed (the alternative the plan floated, summing deformation contributions by hand,
 *  is exactly what `heightAt` already does). */
const dryPitCarve: DiagnosticRule = {
  id: 'carve.dry-pit',
  severity: 'warn',
  description: 'A carved hollow has no water/road/bridge nearby — a dark, purposeless pit.',
  evaluate(ctx) {
    const { width, height, tiles } = ctx.map;
    // No tile data ⇒ nothing to correlate a carve against (wet/road/isolated are all
    // tile reads) — bail before touching the deformation store at all. Guards synthetic
    // test/Fate-context maps that carry a `roadGraph` for OTHER rules but `tiles: []`
    // and no real `seed`: without this, `getWorldDeformationStore` still builds a real
    // (if meaningless) river network off an undefined-seed heightfield, and since every
    // tile lookup against an empty array is "not water/road", ALL of it reads as
    // isolated — a false-positive generator that has nothing to do with a real world.
    if (!width || !height || !tiles?.length) return [];
    const store = getWorldDeformationStore(ctx.map);
    if (store.size === 0) return [];
    const isWetOrRoad = (x: number, y: number): boolean => {
      const t = tiles[y]?.[x]?.type;
      return !!t && (WATER_TYPES.has(t) || ROAD_TILE_TYPES.has(t));
    };
    const R = DRY_PIT_ISOLATION_RADIUS_TILES;
    const depthOf = new Map<string, number>();
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (isWetOrRoad(x, y)) continue;
        const depth = baseHeightAt(ctx.map, x, y) - heightAt(ctx.map, store, x, y);
        if (depth <= DRY_PIT_MIN_DEPTH_M) continue;
        let isolated = true;
        for (let dy = -R; dy <= R && isolated; dy++) {
          for (let dx = -R; dx <= R && isolated; dx++) {
            if (isWetOrRoad(x + dx, y + dy)) isolated = false;
          }
        }
        if (isolated) depthOf.set(cellKey(x, y), depth);
      }
    }
    if (!depthOf.size) return [];
    // Cluster contiguous (4-connected) flagged cells into one diagnostic per pit.
    const seen = new Set<string>();
    const clusters: { cells: [number, number][]; maxDepth: number }[] = [];
    for (const key of [...depthOf.keys()].sort()) {
      if (seen.has(key)) continue;
      const ci = key.indexOf(','); const sx = Number(key.slice(0, ci)), sy = Number(key.slice(ci + 1));
      const stack: [number, number][] = [[sx, sy]];
      seen.add(key);
      const cells: [number, number][] = [];
      let maxDepth = 0;
      while (stack.length) {
        const [cx, cy] = stack.pop()!;
        cells.push([cx, cy]);
        maxDepth = Math.max(maxDepth, depthOf.get(cellKey(cx, cy)) ?? 0);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as [number, number][]) {
          const nk = cellKey(cx + dx, cy + dy);
          if (depthOf.has(nk) && !seen.has(nk)) { seen.add(nk); stack.push([cx + dx, cy + dy]); }
        }
      }
      clusters.push({ cells, maxDepth });
    }
    return clusters
      .map((c) => {
        const cx = Math.round(c.cells.reduce((s, [x]) => s + x, 0) / c.cells.length);
        const cy = Math.round(c.cells.reduce((s, [, y]) => s + y, 0) / c.cells.length);
        return { cx, cy, cells: c.cells, maxDepth: c.maxDepth };
      })
      .sort((a, b) => (a.cy * width + a.cx) - (b.cy * width + b.cx))
      .map((c) => ({
        rule: dryPitCarve.id, severity: dryPitCarve.severity,
        message: `dry carved pit at (${c.cx},${c.cy}) — ${c.cells.length} cell(s), max depth ${c.maxDepth.toFixed(1)}m, no water/road/bridge nearby`,
        locus: { tiles: c.cells.slice(0, 24).map(([x, y]) => ({ x, y })) },
        metrics: { cells: c.cells.length, maxDepthM: Math.round(c.maxDepth * 10) / 10, cx: c.cx, cy: c.cy },
      }));
  },
};

/** Distance (tiles) to the nearest WATER tile within a box of radius `maxR` of (x,y), or
 *  Infinity if none. A small local scan — cheap at worldgen-lint scale. */
function nearestWaterDist(map: DiagnosticContext['map'], x: number, y: number, maxR: number): number {
  const cx = Math.round(x), cy = Math.round(y), r = Math.ceil(maxR);
  let best = Infinity;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const t = map.tiles[cy + dy]?.[cx + dx];
      if (t && WATER_TYPES.has(t.type)) { const d = Math.hypot(dx, dy); if (d < best) best = d; }
    }
  }
  return best;
}

const RIVERSIDE_PROXIMITY_TILES = 2.5;   // water within this (but not ON the road) = "alongside"
const RIVERSIDE_MIN_RUN_TILES = 6;       // a riverside stretch must run at least this far

/** INFO — a road runs ALONGSIDE open water for a long stretch (water beside it, not a crossing).
 *  Such a road wants an embankment/levee to stay dry — the DETECTION half of "road-river
 *  relationship + embankments" (#24); the terrain-deformation apply is the (riskier) other half.
 *  Excludes the road's own bridge cells (a crossing is correct, not riverside). Pure read. */
const riversideUnbankedRoad: DiagnosticRule = {
  id: 'road.riverside-unbanked',
  severity: 'info',
  description: 'A road runs alongside open water for a long stretch — it wants an embankment/levee.',
  evaluate(ctx) {
    const g = ctx.map.roadGraph;
    if (!g) return [];
    const W = ctx.map.width;
    const out: Diagnostic[] = [];
    for (const e of g.edges) {
      if (e.feature !== 'road' || e.polyline.length < 2) continue;
      const bridges = new Set(e.bridgeCells);
      let run = 0;
      for (let k = 0; k + 1 < e.polyline.length; k++) {
        const a = e.polyline[k], b = e.polyline[k + 1];
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        if (bridges.has(Math.round(my) * W + Math.round(mx))) continue;   // a crossing, not riverside
        const d = nearestWaterDist(ctx.map, mx, my, RIVERSIDE_PROXIMITY_TILES);
        if (d >= 0.6 && d <= RIVERSIDE_PROXIMITY_TILES) run += Math.hypot(b.x - a.x, b.y - a.y);
      }
      if (run >= RIVERSIDE_MIN_RUN_TILES) out.push({
        rule: this.id, severity: this.severity,
        message: `road ${e.id} runs alongside water for ~${Math.round(run)} tiles — wants an embankment`,
        locus: { edges: [e.id] },
        metrics: { riversideTiles: Math.round(run) },
      });
    }
    return out.sort((a, b) => (b.metrics?.riversideTiles ?? 0) - (a.metrics?.riversideTiles ?? 0));
  },
};

// ── Fort / defended-complex rules ──────────────────────────────────────────────────
//
// A complex placed by `placeComplexOnPatch` writes `map.earthworks` (motte/ditch) AND
// closed ring `BarrierRun`s with a gate. These rules read that geometry to check the
// things ONLY a defended enclosure has: its buildings are actually inside the curtain,
// the gateway is clear, the gate leads into a connected ward, and the spoil balances.
// Every rule is gated on `map.earthworks?.length` — a fort signal absent from ordinary
// settlements (they have croft barriers but no earthworks), so these no-op everywhere
// the game/MCP/Fate lint today and only light up on a real complex.

/** Even-odd point-in-polygon over a tile-space ring path. */
function pointInPolygon(x: number, y: number, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-9) + xi) inside = !inside;
  }
  return inside;
}

const meanRadius = (poly: [number, number][], cx: number, cy: number): number => {
  let s = 0; for (const [x, y] of poly) s += Math.hypot(x - cx, y - cy);
  return poly.length ? s / poly.length : 0;
};

interface FortGeometry {
  centre: { x: number; y: number };
  outer: PlacedBarrier;          // outermost enclosing ring
  rings: PlacedBarrier[];        // every ring that encloses the centre
}

/** Recover the fort enclosure from map state, or null if this world isn't a complex.
 *  Fort = has earthworks AND ≥1 closed barrier ring that contains the motte/ward centre. */
function fortGeometry(ctx: DiagnosticContext): FortGeometry | null {
  const ews = ctx.map.earthworks;
  if (!ews || !ews.length) return null;
  const closed = (ctx.map.barrierRuns ?? []).filter((b) => {
    const p = b.run.path;
    return p.length >= 4 && Math.hypot(p[0][0] - p[p.length - 1][0], p[0][1] - p[p.length - 1][1]) < 1.5;
  });
  if (!closed.length) return null;
  const motte = ews.find((e) => e.kind === 'motte' && e.centre)?.centre;
  let centre = motte;
  if (!centre) { // fall back to the mean of ring centroids
    let sx = 0, sy = 0, n = 0;
    for (const b of closed) for (const [x, y] of b.run.path) { sx += x; sy += y; n++; }
    centre = n ? { x: sx / n, y: sy / n } : undefined;
  }
  if (!centre) return null;
  const enclosing = closed.filter((b) => pointInPolygon(centre!.x, centre!.y, b.run.path));
  if (!enclosing.length) return null;
  const outer = enclosing.reduce((m, b) =>
    meanRadius(b.run.path, centre!.x, centre!.y) > meanRadius(m.run.path, centre!.x, centre!.y) ? b : m);
  return { centre, outer, rings: enclosing };
}

/** Solid cells of buildings that belong to the fort (centroid within `reach` of the
 *  centre), so a distant settlement house never gets dragged into a fort rule. */
function fortBuildingCells(world: World, centre: { x: number; y: number }, reach: number): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const [id, cells] of buildingStructureCells(world)) {
    if (!cells.size) continue;
    let sx = 0, sy = 0;
    for (const c of cells) { const i = c.indexOf(','); sx += +c.slice(0, i); sy += +c.slice(i + 1); }
    if (Math.hypot(sx / cells.size - centre.x, sy / cells.size - centre.y) <= reach) out.set(id, cells);
  }
  return out;
}

/** WARN — a complex building stands (partly) OUTSIDE its outermost curtain. */
const fortBuildingOutsideEnclosure: DiagnosticRule = {
  id: 'fort.building-outside-enclosure',
  severity: 'warn',
  description: 'A complex building stands outside its defensive enclosure.',
  evaluate(ctx) {
    const fg = fortGeometry(ctx);
    if (!fg) return [];
    const poly = fg.outer.run.path;
    const reach = meanRadius(poly, fg.centre.x, fg.centre.y) * 2;
    const out: Diagnostic[] = [];
    for (const [id, cells] of fortBuildingCells(ctx.world, fg.centre, reach)) {
      const outside: { x: number; y: number }[] = [];
      for (const c of cells) {
        const i = c.indexOf(','); const x = +c.slice(0, i), y = +c.slice(i + 1);
        if (!pointInPolygon(x, y, poly)) outside.push({ x, y });
      }
      if (outside.length) out.push({
        rule: this.id, severity: this.severity,
        message: `building ${id} has ${outside.length} cell(s) outside the enclosure`,
        locus: { entities: [id], tiles: outside },
        metrics: { cells: outside.length },
      });
    }
    return out.sort((a, b) => a.locus.entities![0].localeCompare(b.locus.entities![0]));
  },
};

/** WARN — a building blocks the gateway gap (the gate must stay passable). */
const fortGateObstructed: DiagnosticRule = {
  id: 'fort.gate-obstructed',
  severity: 'warn',
  description: 'A building footprint sits on a gate opening, blocking passage.',
  evaluate(ctx) {
    const fg = fortGeometry(ctx);
    if (!fg) return [];
    const reach = meanRadius(fg.outer.run.path, fg.centre.x, fg.centre.y) * 2;
    const solid = new Set<string>();
    for (const cells of fortBuildingCells(ctx.world, fg.centre, reach).values()) for (const c of cells) solid.add(c);
    const out: Diagnostic[] = [];
    for (const ring of fg.rings) {
      if (!ring.run.gates.length) continue;
      const hits = barrierFootprintTiles(ring.run).gate.filter(([x, y]) => solid.has(cellKey(x, y)));
      if (hits.length) out.push({
        rule: this.id, severity: this.severity,
        message: `gate of ${ring.id} blocked by a building on ${hits.length} cell(s)`,
        locus: { entities: [ring.id], tiles: hits.map(([x, y]) => ({ x, y })) },
        metrics: { cells: hits.length },
      });
    }
    return out.sort((a, b) => a.locus.entities![0].localeCompare(b.locus.entities![0]));
  },
};

/** WARN — the gate doesn't actually lead into a connected ward: flood-filling from the
 *  gate (through the open yard, around buildings + curtain) reaches too little of the
 *  enclosed open ground. Catches a sealed gate or a ward a building has cut in two —
 *  the "gate reachability / ward access-chain" check. */
const fortWardUnreachable: DiagnosticRule = {
  id: 'fort.ward-unreachable',
  severity: 'warn',
  description: 'The gate does not lead into a connected ward (sealed or fragmented).',
  evaluate(ctx) {
    const fg = fortGeometry(ctx);
    if (!fg || !fg.outer.run.gates.length) return [];
    const poly = fg.outer.run.path;
    const reach = meanRadius(poly, fg.centre.x, fg.centre.y) * 2;
    // Blocked = every fort curtain's blocking cells + fort building solids (gate gaps stay open).
    const blocked = new Set<string>();
    for (const ring of fg.rings) for (const [x, y] of barrierFootprintTiles(ring.run).blocking) blocked.add(cellKey(x, y));
    for (const cells of fortBuildingCells(ctx.world, fg.centre, reach).values()) for (const c of cells) blocked.add(c);
    // Bounding box of the outer ring (padded), the BFS arena.
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of poly) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
    minX = Math.floor(minX) - 1; minY = Math.floor(minY) - 1; maxX = Math.ceil(maxX) + 1; maxY = Math.ceil(maxY) + 1;
    const inWard = (x: number, y: number): boolean => pointInPolygon(x, y, poly) && !blocked.has(cellKey(x, y));
    let wardTotal = 0;
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) if (inWard(x, y)) wardTotal++;
    if (wardTotal < 4) return [];   // degenerate ward — nothing meaningful to reach
    // Seed the flood at the gate centre (an open gap cell), then BFS over open ward cells.
    const { run } = fg.outer;
    const { path, gates } = run;
    let total = 0; for (let i = 1; i < path.length; i++) total += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
    const gate = gates[0];
    let acc = 0, gx = path[0][0], gy = path[0][1];
    for (let i = 1; i < path.length; i++) {
      const len = Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
      if (gate.t <= acc + len) { const u = (gate.t - acc) / (len || 1); gx = path[i - 1][0] + (path[i][0] - path[i - 1][0]) * u; gy = path[i - 1][1] + (path[i][1] - path[i - 1][1]) * u; break; }
      acc += len;
    }
    // Step a couple of tiles inward from the gate to land inside the ward.
    const inwardX = fg.centre.x - gx, inwardY = fg.centre.y - gy, mag = Math.hypot(inwardX, inwardY) || 1;
    let seedX = Math.round(gx + (inwardX / mag) * 2), seedY = Math.round(gy + (inwardY / mag) * 2);
    if (!inWard(seedX, seedY)) { seedX = Math.round(gx); seedY = Math.round(gy); }   // fall back to the gap itself
    const seen = new Set<string>();
    const queue: [number, number][] = [];
    if (inWard(seedX, seedY) || (pointInPolygon(seedX, seedY, poly) === false && !blocked.has(cellKey(seedX, seedY)))) {
      seen.add(cellKey(seedX, seedY)); queue.push([seedX, seedY]);
    }
    let reachedWard = 0;
    while (queue.length) {
      const [x, y] = queue.pop()!;
      if (inWard(x, y)) reachedWard++;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as [number, number][]) {
        const nx = x + dx, ny = y + dy;
        if (nx < minX || ny < minY || nx > maxX || ny > maxY) continue;
        const k = cellKey(nx, ny);
        if (seen.has(k) || blocked.has(k)) continue;
        if (!pointInPolygon(nx, ny, poly) && Math.hypot(nx - gx, ny - gy) > 3) continue; // stay in/near the ward
        seen.add(k); queue.push([nx, ny]);
      }
    }
    const fraction = reachedWard / wardTotal;
    if (fraction >= 0.5) return [];
    return [{
      rule: this.id, severity: this.severity,
      message: `gate reaches only ${(fraction * 100).toFixed(0)}% of the ward — sealed or fragmented`,
      locus: { entities: [fg.outer.id], tiles: [{ x: Math.round(gx), y: Math.round(gy) }] },
      metrics: { reachedFraction: Math.round(fraction * 100) / 100, wardCells: wardTotal },
    }];
  },
};

/** INFO — the cut-and-fill ledger is unbalanced (spoil should be conserved: a motte is
 *  heaped from the earth its ditch removes). A healthy `placeComplexOnPatch` nets ~0. */
const fortSpoilImbalance: DiagnosticRule = {
  id: 'fort.spoil-imbalance',
  severity: 'info',
  description: 'Earthwork cut and fill volumes do not balance (spoil not conserved).',
  evaluate(ctx) {
    const ews = ctx.map.earthworks;
    if (!ews || !ews.length) return [];
    let fill = 0, cut = 0;
    for (const e of ews) { if (e.volume > 0) fill += e.volume; else cut += -e.volume; }
    const moved = fill + cut;
    if (moved < 1e-6) return [];
    const imbalance = Math.abs(fill - cut) / moved;
    if (imbalance <= 0.15) return [];
    const at = ews.find((e) => e.kind === 'motte' && e.centre)?.centre;
    return [{
      rule: this.id, severity: this.severity,
      message: `earthwork spoil ${(imbalance * 100).toFixed(0)}% unbalanced (fill ${fill.toFixed(0)} vs cut ${cut.toFixed(0)})`,
      locus: at ? { tiles: [{ x: Math.round(at.x), y: Math.round(at.y) }] } : {},
      metrics: { fill: Math.round(fill), cut: Math.round(cut), imbalance: Math.round(imbalance * 100) / 100 },
    }];
  },
};

/** The registered rule set, run in order. */
export const DEFAULT_RULES: DiagnosticRule[] = [
  buildingOverlap,
  barrierThroughBuilding,
  barrierOverWater,
  roadThroughBuilding,
  buildingOnWater,
  roadFordsWater,
  bridgeSeating,
  bridgeTilesVsDeck,
  redundantParallelRoad,
  parallelCorridorRoad,
  riversideUnbankedRoad,
  dryPitCarve,
  oversubscribedJunction,
  fortBuildingOutsideEnclosure,
  fortGateObstructed,
  fortWardUnreachable,
  fortSpoilImbalance,
];

/** Run every rule against a world and grade the findings. Deterministic for a world. */
export function evaluateConnectome(
  ctx: DiagnosticContext,
  rules: DiagnosticRule[] = DEFAULT_RULES,
): DiagnosticReport {
  const diagnostics: Diagnostic[] = [];
  for (const rule of rules) {
    try { diagnostics.push(...rule.evaluate(ctx)); }
    catch { /* a broken rule must never crash the linter */ }
  }
  const counts: Record<DiagnosticSeverity, number> = { error: 0, warn: 0, info: 0 };
  const byRule: Record<string, number> = {};
  for (const d of diagnostics) { counts[d.severity]++; byRule[d.rule] = (byRule[d.rule] ?? 0) + 1; }
  return { total: diagnostics.length, counts, byRule, diagnostics };
}
