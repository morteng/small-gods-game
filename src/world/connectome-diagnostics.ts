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

/** The registered rule set, run in order. */
export const DEFAULT_RULES: DiagnosticRule[] = [
  buildingOverlap,
  barrierThroughBuilding,
  roadThroughBuilding,
  redundantParallelRoad,
  oversubscribedJunction,
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
