// src/world/connectome/defense-contracts.ts
//
// A raider's-eye validation of the defensive ring — the fortification analogue of
// `wall-contracts.ts` (which validates "roads lead to gates"; this validates "the wall
// actually stops someone"). Registered as built-in contracts at import — the eval entry
// points (map-generator, game-query) import this module so the registry always has them.
//
//   • defense.closed-circuit   (invariant, error) — a hostile agent pathfound from ≥4
//     map-edge approaches can reach the settlement core ONLY through a gate or a
//     nature-defended (water/steep) opening — never through a forgotten hole in the
//     blocking-cell circuit.
//   • defense.gate-observed    (invariant, warn)  — every gate's final approach spends
//     most of its length within bowshot of a flanking tower.
//   • defense.no-cheap-bypass  (invariant, warn)  — a route through a real gate should not
//     be dramatically beaten by a nature-defended (water/steep) bypass.
//
// Pure + deterministic: reads map.barrierRuns + map.tiles + world entities/registry via the
// EXISTING A* (`@/sim/pathfinding`) — no second pathfinder. No Math.random.
//
// Round 6 (WP-R terrain-seeking rings, WP-S coverage towers) lands in parallel; this module
// degrades gracefully when their output is absent so it is green against TODAY's main and
// stays green once they land:
//   - WP-R's per-segment `defends: 'open'|'water'|'steep'` metadata is read defensively off
//     `run.segments` (or `(barrier as {segments}).segments`) ALIGNED 1:1 WITH PATH SEGMENTS
//     (`run.segments[i]` describes `path[i]→path[i+1]`); absent ⇒ every segment is 'open'
//     (no exemption beyond the existing gate/gap array — matches today's behaviour).
//   - WP-S's tower placement is read via `world.query({ tag: 'tower' })`; if that comes back
//     empty (no placement system has landed yet), a GEOMETRIC fallback stands in — a tower at
//     every ring-corner vertex plus a flanking pair at every real gate, mirroring what
//     `parametric-barrier-source.ts` renders today. The integrator should re-point
//     `ringTowerPositions` at WP-S's real output if it uses a different tag/kind.

import type { Diagnostic } from '@/world/connectome-diagnostics';
import type { Contract, ContractDeclaration } from '@/world/connectome-contracts';
import { registerContract } from '@/world/connectome-contracts';
import {
  barrierFootprintTiles, gatePoint, type PlacedBarrier, type BarrierRun, type BarrierGate,
} from '@/world/barrier';
import { findPath, isWalkable } from '@/sim/pathfinding';
import type { GameMap } from '@/core/types';
import type { World } from '@/world/world';

// ── Tunables (overridable via ContractDeclaration.params, like `gate.road-connected`'s `reach`) ──

const DEFAULT_RADIUS = 12;      // tiles a tower must reach to "observe" an approach tile
const DEFAULT_M = 6;            // last M tiles of a gate approach inspected
const DEFAULT_N = 4;            // of which at least N must be tower-observed
const DEFAULT_MIN_RATIO = 1;    // non-gate/gate cost ratio below which we warn
const APPROACH_OUT_DIST = 14;   // tiles outward from a gate/gap used to seed an approach path
const ENTRY_DIRS: [number, number][] = [
  [0, -1], [0, 1], [-1, 0], [1, 0], [1, -1], [1, 1], [-1, -1], [-1, 1],
];
// Long-range map-edge→core A* is the one genuinely expensive operation this module does
// (~150-500ms each on a large generated map, dominated by the shared A*'s linear open-set
// scan — not this module's own overhead). Capped at the spec's stated minimum so a ring with
// many settlements-worth of rings doesn't multiply lint runtime; measured ~1-2s/ring total.
const MAX_ENTRIES = 4;          // cap long-range A* calls per ring (perf) — spec's "≥4" minimum
const INWARD_STEPS = 100;       // bound the walk-inward-from-the-boundary search
const SNAP_RADIUS_CORE = 10;
const SNAP_RADIUS_GATE = 4;
const SNAP_RADIUS_APPROACH = 6;

// ── Small shared geometry helpers ───────────────────────────────────────────────────

/** The scoped ring for a contract instance: `scope.entities[0]` is the ring (barrier) id. */
function ringOfScope(barrierRuns: PlacedBarrier[] | undefined, entities?: string[]): PlacedBarrier | undefined {
  const id = entities?.[0];
  if (!id || !barrierRuns) return undefined;
  return barrierRuns.find((b) => b.id === id);
}

function pointToSegmentDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 1e-9 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

/** The path segment [path[i], path[i+1]] nearest (x,y), and the distance to it. */
function nearestSegment(path: [number, number][], x: number, y: number): { index: number; dist: number } {
  let bestI = 0, bestD = Infinity;
  for (let i = 0; i < path.length - 1; i++) {
    const [ax, ay] = path[i], [bx, by] = path[i + 1];
    const d = pointToSegmentDist(x, y, ax, ay, bx, by);
    if (d < bestD) { bestD = d; bestI = i; }
  }
  return { index: bestI, dist: bestD };
}
const nearestSegmentIndex = (path: [number, number][], x: number, y: number): number => nearestSegment(path, x, y).index;
const nearestPathDist = (path: [number, number][], x: number, y: number): number => nearestSegment(path, x, y).dist;

/** Standard ray-casting point-in-polygon; `path` is CLOSED (last point === first, per traceRing). */
function pointInPolygon(path: [number, number][], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = path.length - 1; i < path.length; j = i++) {
    const [xi, yi] = path[i], [xj, yj] = path[j];
    const crosses = (yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-12) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

type Defends = 'open' | 'water' | 'steep';

/** WP-R's per-segment metadata, read defensively (absent/malformed ⇒ undefined ⇒ all 'open'). */
function segmentsOf(b: PlacedBarrier): { defends: Defends }[] | undefined {
  const raw = (b.run as unknown as { segments?: unknown }).segments
    ?? (b as unknown as { segments?: unknown }).segments;
  if (!Array.isArray(raw) || raw.length !== b.run.path.length - 1) return undefined;
  if (!raw.every((s) => s && typeof s === 'object' && typeof (s as { defends?: unknown }).defends === 'string')) {
    return undefined;
  }
  return raw as { defends: Defends }[];
}

function defendsAt(b: PlacedBarrier, x: number, y: number): Defends {
  const segs = segmentsOf(b);
  if (!segs) return 'open';
  return segs[nearestSegmentIndex(b.run.path, x, y)]?.defends ?? 'open';
}

/** Expanding-ring search for the nearest walkable tile to (x,y), bounded by `maxR`. */
function nearestWalkable(map: GameMap, world: World, x: number, y: number, maxR: number): { x: number; y: number } | null {
  const cx = Math.round(x), cy = Math.round(y);
  if (isWalkable(map, cx, cy, world)) return { x: cx, y: cy };
  for (let r = 1; r <= maxR; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; // ring only (skip interior re-checks)
        const tx = cx + dx, ty = cy + dy;
        if (isWalkable(map, tx, ty, world)) return { x: tx, y: ty };
      }
    }
  }
  return null;
}

/** The settlement's "core" — nearest building to the ring's protected centroid, snapped to a
 *  walkable tile (a building's own cell is typically solid). Falls back to the centroid itself. */
function settlementCore(map: GameMap, world: World, run: BarrierRun): { x: number; y: number } | null {
  const cx = run.centroid ? run.centroid[0] : run.path[0][0];
  const cy = run.centroid ? run.centroid[1] : run.path[0][1];
  let best: { x: number; y: number } | null = null, bestD = Infinity;
  for (const e of world.query({ tag: 'building' })) {
    const d = Math.hypot(e.x - cx, e.y - cy);
    if (d < bestD) { bestD = d; best = { x: e.x, y: e.y }; }
  }
  const seed = best ?? { x: cx, y: cy };
  return nearestWalkable(map, world, seed.x, seed.y, SNAP_RADIUS_CORE);
}

/** Up to `MAX_ENTRIES` map-boundary points, walked inward from the edge until a walkable tile
 *  outside the ring is found (never crosses into the ring's protected interior while searching). */
function edgeEntryPoints(map: GameMap, world: World, core: { x: number; y: number }, run: BarrierRun): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (const [dx, dy] of ENTRY_DIRS) {
    if (out.length >= MAX_ENTRIES) break;
    let tMax = Infinity;
    if (dx !== 0) tMax = Math.min(tMax, dx > 0 ? (map.width - 1 - core.x) / dx : (0 - core.x) / dx);
    if (dy !== 0) tMax = Math.min(tMax, dy > 0 ? (map.height - 1 - core.y) / dy : (0 - core.y) / dy);
    if (!Number.isFinite(tMax) || tMax <= 0) continue;
    const ex = Math.max(0, Math.min(map.width - 1, Math.round(core.x + dx * tMax)));
    const ey = Math.max(0, Math.min(map.height - 1, Math.round(core.y + dy * tMax)));
    const inDx = dx === 0 ? 0 : -Math.sign(dx), inDy = dy === 0 ? 0 : -Math.sign(dy);
    let found: { x: number; y: number } | null = null;
    for (let step = 0; step <= INWARD_STEPS; step++) {
      const tx = ex + inDx * step, ty = ey + inDy * step;
      if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) break;
      if (pointInPolygon(run.path, tx, ty)) break;   // walked past the ring — stop before entering it
      if (isWalkable(map, tx, ty, world)) { found = { x: tx, y: ty }; break; }
    }
    if (found) out.push(found);
  }
  return out;
}

/** Outward unit normal at (x,y) on the ring line, oriented away from the centroid. */
function outwardNormal(run: BarrierRun, x: number, y: number): [number, number] {
  const i = nearestSegmentIndex(run.path, x, y);
  const [ax, ay] = run.path[i], [bx, by] = run.path[i + 1];
  const dx = bx - ax, dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  let nx = -dy / len, ny = dx / len;
  const cx = run.centroid ? run.centroid[0] : ax, cy = run.centroid ? run.centroid[1] : ay;
  if (nx * (x - cx) + ny * (y - cy) < 0) { nx = -nx; ny = -ny; }
  return [nx, ny];
}

/** A point `outDist` tiles outward from a gate, snapped to the nearest walkable tile. */
function outwardApproachPoint(map: GameMap, world: World, run: BarrierRun, gx: number, gy: number, outDist: number): { x: number; y: number } | null {
  const [nx, ny] = outwardNormal(run, gx, gy);
  return nearestWalkable(map, world, gx + nx * outDist, gy + ny * outDist, SNAP_RADIUS_APPROACH);
}

/** The approach path from just outside a gate to the gate itself (its own cell), via the shared
 *  A*. Used to inspect the FINAL stretch a raider walks before reaching the opening. */
function gateApproachPath(map: GameMap, world: World, run: BarrierRun, gate: BarrierGate): { x: number; y: number }[] | null {
  const [gx, gy] = gatePoint(run, gate);
  const gSnap = nearestWalkable(map, world, gx, gy, SNAP_RADIUS_GATE);
  if (!gSnap) return null;
  const aSnap = outwardApproachPoint(map, world, run, gx, gy, APPROACH_OUT_DIST);
  if (!aSnap) return null;
  const res = findPath(map, aSnap.x, aSnap.y, gSnap.x, gSnap.y, world);
  return res ? res.path : null;
}

/** Tower positions for a ring: prefers the coverage-placement pass's authoritative `run.towers`
 *  (WP-S — persisted plain data, exactly what the renderer draws), then any entities tagged
 *  'tower', and only then a geometric proxy — a tower at every ring-corner vertex + a flanking
 *  pair per real gate, mirroring the legacy render-time artifact. */
function ringTowerPositions(world: World, run: BarrierRun): { x: number; y: number }[] {
  if (run.towers?.length) return run.towers.map((t) => ({ x: t.x, y: t.y }));
  const placed = world.query({ tag: 'tower' }).map((e) => ({ x: e.x, y: e.y }));
  if (placed.length) return placed;

  const pts: { x: number; y: number }[] = [];
  for (const [x, y] of run.path.slice(0, -1)) pts.push({ x, y });   // corners (path is closed)
  for (const g of run.gates) {
    if (g.kind === 'gap') continue;
    const [gx, gy] = gatePoint(run, g);
    const i = nearestSegmentIndex(run.path, gx, gy);
    const [ax, ay] = run.path[i], [bx, by] = run.path[i + 1];
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    const off = g.width / 2 + 2;
    pts.push({ x: gx - ux * off, y: gy - uy * off }, { x: gx + ux * off, y: gy + uy * off });
  }
  return pts;
}

/** Cheapest hostile route from OUTSIDE one of `gates` to `core`, or null if none reachable. */
function cheapestApproachCost(map: GameMap, world: World, run: BarrierRun, gates: BarrierGate[], core: { x: number; y: number }): number | null {
  let best: number | null = null;
  for (const g of gates) {
    const [gx, gy] = gatePoint(run, g);
    const aSnap = outwardApproachPoint(map, world, run, gx, gy, APPROACH_OUT_DIST);
    if (!aSnap) continue;
    const res = findPath(map, aSnap.x, aSnap.y, core.x, core.y, world);
    if (res && (best === null || res.cost < best)) best = res.cost;
  }
  return best;
}

// ── Contract 1: closed-circuit ──────────────────────────────────────────────────────

export const defenseClosedCircuit: Contract = {
  id: 'defense.closed-circuit',
  level: 'settlement',
  kind: 'invariant',
  severity: 'error',
  description: 'A hostile agent from any map-edge approach reaches the settlement core only '
    + 'through a gate or a nature-defended opening — never through a forgotten hole in the ring.',
  evaluate(ctx, scope) {
    const b = ringOfScope(ctx.map.barrierRuns, scope.entities);
    if (!b || !b.run.centroid || b.run.path.length < 4) return [];
    const core = settlementCore(ctx.map, ctx.world, b.run);
    if (!core) return [];
    const entries = edgeEntryPoints(ctx.map, ctx.world, core, b.run);
    if (!entries.length) return [];

    const { gate: gateCells } = barrierFootprintTiles(b.run);
    const gateSet = new Set(gateCells.map(([x, y]) => `${x},${y}`));
    const halfThickness = b.run.thickness / 2 + 1.5;

    const out: Diagnostic[] = [];
    for (const entry of entries) {
      const res = findPath(ctx.map, entry.x, entry.y, core.x, core.y, ctx.world);
      if (!res) continue;   // legitimately unreachable from this side (e.g. facing open sea)
      let crossedLegit = false;
      for (const p of res.path) {
        if (gateSet.has(`${p.x},${p.y}`)) { crossedLegit = true; break; }
        if (nearestPathDist(b.run.path, p.x, p.y) <= halfThickness) {
          const d = defendsAt(b, p.x, p.y);
          if (d === 'water' || d === 'steep') { crossedLegit = true; break; }
        }
      }
      if (!crossedLegit) {
        out.push({
          rule: 'defense.closed-circuit', severity: 'error',
          message: `a hostile path from map edge (${entry.x},${entry.y}) reaches the core of `
            + `${scope.poi ?? b.id} without crossing the ${b.run.kind} at a gate or a `
            + `nature-defended opening — a hole in the circuit`,
          locus: { entities: [b.id], pois: scope.poi ? [scope.poi] : [], tiles: [entry, core] },
        });
      }
    }
    return out;
  },
};

// ── Contract 2: gate-observed ────────────────────────────────────────────────────────

export const defenseGateObserved: Contract = {
  id: 'defense.gate-observed',
  level: 'settlement',
  kind: 'invariant',
  severity: 'warn',
  description: "Every gate's final approach spends most of its length within a flanking tower's reach.",
  evaluate(ctx, scope, params) {
    const b = ringOfScope(ctx.map.barrierRuns, scope.entities);
    if (!b || !b.run.centroid || b.run.path.length < 4) return [];
    const radius = Number(params?.radius ?? DEFAULT_RADIUS);
    const m = Math.max(1, Math.round(Number(params?.m ?? DEFAULT_M)));
    const n = Math.max(1, Math.round(Number(params?.n ?? DEFAULT_N)));
    const towers = ringTowerPositions(ctx.world, b.run);

    const out: Diagnostic[] = [];
    for (const g of b.run.gates) {
      if (g.kind === 'gap') continue;
      const approach = gateApproachPath(ctx.map, ctx.world, b.run, g);
      if (!approach || !approach.length) continue;
      const tail = approach.slice(-m);
      const within = tail.filter((p) => towers.some((t) => Math.hypot(t.x - p.x, t.y - p.y) <= radius)).length;
      const need = Math.min(n, tail.length);
      if (within < need) {
        out.push({
          rule: 'defense.gate-observed', severity: 'warn',
          message: `gate of ${scope.poi ?? b.id} at t=${g.t.toFixed(1)} is tower-observed for only `
            + `${within}/${tail.length} of its final approach tiles (need ${need})`,
          locus: { entities: [b.id], pois: scope.poi ? [scope.poi] : [] },
          metrics: { within, of: tail.length, need, radius },
        });
      }
    }
    return out;
  },
};

// ── Contract 3: no-cheap-bypass ──────────────────────────────────────────────────────

export const defenseNoCheapBypass: Contract = {
  id: 'defense.no-cheap-bypass',
  level: 'settlement',
  kind: 'invariant',
  severity: 'warn',
  description: 'A route through a real gate should not be dramatically beaten by a nature-defended bypass.',
  evaluate(ctx, scope, params) {
    const b = ringOfScope(ctx.map.barrierRuns, scope.entities);
    if (!b || !b.run.centroid || b.run.path.length < 4) return [];
    const core = settlementCore(ctx.map, ctx.world, b.run);
    if (!core) return [];
    const realGates = b.run.gates.filter((g) => g.kind !== 'gap');
    const bypassGates = b.run.gates.filter((g) => g.kind === 'gap');
    if (!realGates.length || !bypassGates.length) return [];   // nothing to compare (common case today)

    const gateCost = cheapestApproachCost(ctx.map, ctx.world, b.run, realGates, core);
    const bypassCost = cheapestApproachCost(ctx.map, ctx.world, b.run, bypassGates, core);
    if (gateCost == null || bypassCost == null || gateCost === 0) return [];

    const ratio = bypassCost / gateCost;
    const minRatio = Number(params?.minRatio ?? DEFAULT_MIN_RATIO);
    if (ratio < minRatio) {
      return [{
        rule: 'defense.no-cheap-bypass', severity: 'warn',
        message: `a nature-defended opening of ${scope.poi ?? b.id} is cheaper to raid through `
          + `(cost ${bypassCost.toFixed(1)}) than any real gate (cost ${gateCost.toFixed(1)}, `
          + `ratio ${ratio.toFixed(2)}) — the defends metadata may be too generous`,
        locus: { entities: [b.id], pois: scope.poi ? [scope.poi] : [] },
        metrics: { gateCost, bypassCost, ratio },
      }];
    }
    return [];
  },
};

registerContract(defenseClosedCircuit);
registerContract(defenseGateObserved);
registerContract(defenseNoCheapBypass);

/** Build the contract DECLARATIONS a walled-town recipe commits for the raider's-eye checks —
 *  called alongside `settlementRingContracts` (same defensive-ring filter: centroid-bearing;
 *  same M4 exemption: `ownerPoiId`-tagged RUNTIME complex rings are skipped — see the
 *  contract note on `settlementRingContracts`). */
export function defenseRingContracts(barrierRuns: PlacedBarrier[]): ContractDeclaration[] {
  const decls: ContractDeclaration[] = [];
  for (const b of barrierRuns) {
    if (b.ownerPoiId) continue;                                  // runtime complex rings exempt (M4)
    if (!b.run.centroid || b.run.path.length < 4) continue;
    const poi = b.id.endsWith('_ring') ? b.id.slice(0, -'_ring'.length) : b.id;
    const scope = { poi, entities: [b.id] };
    decls.push({ contract: 'defense.closed-circuit', scope });
    decls.push({ contract: 'defense.gate-observed', scope });
    decls.push({ contract: 'defense.no-cheap-bypass', scope });
  }
  return decls;
}
