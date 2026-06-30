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
import { barrierFootprintTiles, type PlacedBarrier } from '@/world/barrier';

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
  roadThroughBuilding,
  buildingOnWater,
  redundantParallelRoad,
  parallelCorridorRoad,
  riversideUnbankedRoad,
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
