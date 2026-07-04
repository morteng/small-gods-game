// src/world/barrier.ts
import { mToTiles } from '@/render/scale-contract';

export type BarrierKind = 'wall' | 'fence' | 'palisade' | 'rampart' | 'barricade' | 'hedge';
/** An opening in the run at path-distance `t`, `width` tiles wide. `kind` distinguishes a real
 *  GATE (a road crossing — gets a gatehouse + timber leaf) from a plain GAP (where the line meets
 *  water / a building / an open waterfront side — just an opening, no gatehouse). Absent ⇒ 'gate'
 *  (legacy). */
export interface BarrierGate { t: number; width: number; kind?: 'gate' | 'gap' }
export interface BarrierRun {
  kind: BarrierKind;
  path: [number, number][];
  height: number; thickness: number; material: string;
  crenellated?: boolean; posts?: boolean;
  gates: BarrierGate[];
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
  /** Global path-distance (tiles) of this chunk's start, set by `chunkBarrierRun`. The masonry
   *  cross-section phases its merlon rhythm off this so crenellations run CONTINUOUS across the
   *  seams between chunks of one wall (each chunk is a local run starting at its own origin, so
   *  without a global phase the merlon pattern restarts — and a ~half-crenel gap opens — per seam). */
  merlonPhase?: number;
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
