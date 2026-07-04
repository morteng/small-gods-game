// src/world/barrier.ts
import { mToTiles } from '@/render/scale-contract';

export type BarrierKind = 'wall' | 'fence' | 'palisade' | 'rampart' | 'barricade' | 'hedge';
/** An opening in the run at path-distance `t`, `width` tiles wide. `kind` distinguishes a real
 *  GATE (a road crossing — gets a gatehouse + timber leaf) from a plain GAP (where the line meets
 *  water / a building / an open waterfront side — just an opening, no gatehouse). Absent ⇒ 'gate'
 *  (legacy). */
export interface BarrierGate { t: number; width: number; kind?: 'gate' | 'gap' }

/**
 * What nature already does for a ring SEGMENT (the leg `path[i]→path[i+1]`), classified by what
 * lies immediately OUTSIDE it. This is the WP-R↔WP-S interface (Round 6): WP-R's terrain-seeking
 * trace CLASSIFIES each segment; WP-S's coverage-tower/ditch/killing-field passes CONSUME it. Absent
 * ⇒ every segment is treated as `'open'` (the standalone default), so a run without WP-R metadata
 * still places towers and a ditch on every landward face.
 *   • open  — a buildable landward approach; wants a tower within bowshot + a ditch + a killing field.
 *   • water — a river bend / lakeshore / coast fronts this leg (the water is the wall): no ditch, no
 *             killing field, tower spacing unbounded.
 *   • steep — a cliff edge / sharp outward drop defends this leg: keep the curtain, but relax tower
 *             spacing (2×) and skip the ditch.
 */
export type RingDefends = 'open' | 'water' | 'steep';
export interface RingSegment {
  /** Index of the segment's start vertex on `path` (segment = path[i]→path[i+1]). */
  i: number;
  defends: RingDefends;
}

/** A defensive tower committed by the coverage-placement pass (WP-S). `role` records WHY it is
 *  there — a gate FLANKER (paired, framing a gate), a SALIENT (a convex ring corner overlooking two
 *  wall faces), or a FILL tower (keeping an open run within bowshot). The renderer draws square
 *  gatehouse towers for `'gate'` and round drums for `'salient'`/`'fill'`; WP-T's `gate-observed`
 *  lint reads these positions. */
export type TowerRole = 'gate' | 'salient' | 'fill';
export interface TowerPlacement { x: number; y: number; role: TowerRole }

export interface BarrierRun {
  kind: BarrierKind;
  path: [number, number][];
  height: number; thickness: number; material: string;
  crenellated?: boolean; posts?: boolean;
  gates: BarrierGate[];
  /** Per-segment nature-defends classification (WP-R). Parallel to path legs, not necessarily
   *  one-per-leg (only classified legs need an entry); read via `defendsForSegment`. */
  segments?: RingSegment[];
  /** Authoritative defensive-tower positions from the coverage-placement pass (WP-S). When present,
   *  the barrier renderer places towers HERE instead of at RDP corners; absent ⇒ legacy corner-tower
   *  derivation. Persisted plain data on `map.barrierRuns`. */
  towers?: TowerPlacement[];
  /** Ring centre (tiles) — the "inside" the wall protects. Set on a closed defensive ring so
   *  the geometry can face its parapet/merlons/hoardings OUTWARD (away from this point). Absent
   *  on open runs / crofts → geometry falls back to a symmetric (both-edge) parapet. */
  centroid?: [number, number];
  /** Precomputed per-chunk outward sign in the segment-LOCAL frame (+1 ⇒ local +y is outward,
   *  −1 ⇒ local −y). Set by `chunkBarrierRun` from `centroid`; read by the masonry cross-section
   *  so a chunk (which has lost the ring centre in its local frame) still knows which way is out. */
  outwardSign?: number;
  /** Timber HOARDINGS (hourds/brattices): a wartime covered gallery cantilevered out over the
   *  OUTER face at parapet level, so defenders drop stones/quicklime straight down the wall base
   *  a flush parapet can't reach. Needs a known outward side + a crenellated masonry curtain. */
  hoarded?: boolean;
}

/** A barrier as committed by worldgen: its entity id + the run. Persisted on `GameMap`
 *  (plain data → rides `structuredClone(map)` in the save) so the terrain foundation carve
 *  is a pure function of the map, like settlement plans and the road graph. */
export interface PlacedBarrier { id: string; run: BarrierRun }

export const BARRIER_DEFAULTS: Record<BarrierKind, Omit<BarrierRun, 'kind' | 'path' | 'gates'>> = {
  wall:      { height: mToTiles(3.0), thickness: 1, material: 'stone',  crenellated: false }, // 3.0 m
  rampart:   { height: mToTiles(3.5), thickness: 2, material: 'stone',  crenellated: true },  // 3.5 m
  palisade:  { height: mToTiles(2.6), thickness: 1, material: 'timber', posts: true },        // 2.6 m
  fence:     { height: mToTiles(1.1), thickness: 1, material: 'timber', posts: true },        // 1.1 m
  barricade: { height: mToTiles(1.4), thickness: 1, material: 'timber' },                     // 1.4 m
  hedge:     { height: mToTiles(1.5), thickness: 1, material: 'hedge' },                       // 1.5 m living
};

/** The nature-defends class of ring leg `i` (`path[i]→path[i+1]`). Defaults to `'open'` when the run
 *  carries no WP-R metadata, so a standalone run defends every landward leg by construction. */
export function defendsForSegment(run: BarrierRun, i: number): RingDefends {
  return run.segments?.find((s) => s.i === i)?.defends ?? 'open';
}

/** Which path leg contains path-distance `t` → its start-vertex index `i` (leg = path[i]→path[i+1]). */
export function segmentIndexAt(path: [number, number][], t: number): number {
  let acc = 0;
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1], [bx, by] = path[i];
    const len = Math.hypot(bx - ax, by - ay);
    if (t <= acc + len) return i - 1;
    acc += len;
  }
  return Math.max(0, path.length - 2);
}

/** Map a path distance `t` (tiles) to a world point along the polyline. */
function pointAt(path: [number, number][], t: number): [number, number] {
  let acc = 0;
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1], [bx, by] = path[i];
    const len = Math.hypot(bx - ax, by - ay);
    if (t <= acc + len) { const u = (t - acc) / (len || 1); return [ax + (bx - ax) * u, ay + (by - ay) * u]; }
    acc += len;
  }
  return path[path.length - 1];
}
function pathLength(path: [number, number][]): number {
  let s = 0; for (let i = 1; i < path.length; i++) s += Math.hypot(path[i][0] - path[i-1][0], path[i][1] - path[i-1][1]);
  return s;
}

/** World point (tiles) at a gate's centre — the opening's midpoint on the wall line.
 *  Used to route an approach road THROUGH the gate and to test gate↔road connectivity. */
export function gatePoint(run: BarrierRun, gate: BarrierGate): [number, number] {
  return pointAt(run.path, gate.t);
}

/** Tile cells spanned by ONE gate/gap opening (same rasterization the combined
 *  `barrierFootprintTiles` gate pass uses, isolated to a single opening) — so a junction
 *  artifact can OWN exactly the cells of its own gate span (a Gatehouse owns a `gate`, a
 *  WaterGate a `gap`). Deterministic; cells sorted (y, then x). */
export function gateFootprintTiles(run: BarrierRun, gate: BarrierGate): [number, number][] {
  const r = Math.max(0, (run.thickness - 1) / 2);
  const cells = new Map<string, [number, number]>();
  const half = gate.width / 2;
  for (let t = Math.max(0, gate.t - half); t <= gate.t + half; t += 0.34) {
    const [px, py] = pointAt(run.path, t);
    for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
      const cx = Math.round(px) + dx, cy = Math.round(py) + dy;
      cells.set(`${cx},${cy}`, [cx, cy]);
    }
  }
  return [...cells.values()].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
}

/** Rasterize the polyline at `thickness` into tile cells, split blocking vs gate-gap. */
export function barrierFootprintTiles(run: BarrierRun): { blocking: [number, number][]; gate: [number, number][] } {
  const cells = new Map<string, [number, number]>();
  const gateCells = new Set<string>();
  const r = Math.max(0, (run.thickness - 1) / 2);
  for (const g of run.gates) {
    const half = g.width / 2;
    for (let t = Math.max(0, g.t - half); t <= g.t + half; t += 0.34) {
      const [px, py] = pointAt(run.path, t);
      for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) gateCells.add(`${Math.round(px) + dx},${Math.round(py) + dy}`);
    }
  }
  const total = pathLength(run.path);
  for (let t = 0; t <= total; t += 0.34) {
    const [px, py] = pointAt(run.path, t);
    for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
      const cx = Math.round(px) + dx, cy = Math.round(py) + dy, k = `${cx},${cy}`;
      if (!gateCells.has(k)) cells.set(k, [cx, cy]);
    }
  }
  const gate = [...gateCells].map(k => k.split(',').map(Number) as [number, number]);
  return { blocking: [...cells.values()], gate };
}
