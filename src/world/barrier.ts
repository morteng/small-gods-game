// src/world/barrier.ts
import { mToTiles } from '@/render/scale-contract';

export type BarrierKind = 'wall' | 'fence' | 'palisade' | 'rampart' | 'barricade';
export interface BarrierGate { t: number; width: number }   // t = tiles along the path
export interface BarrierRun {
  kind: BarrierKind;
  path: [number, number][];
  height: number; thickness: number; material: string;
  crenellated?: boolean; posts?: boolean;
  gates: BarrierGate[];
}

export const BARRIER_DEFAULTS: Record<BarrierKind, Omit<BarrierRun, 'kind' | 'path' | 'gates'>> = {
  wall:      { height: mToTiles(3.0), thickness: 1, material: 'stone',  crenellated: false }, // 3.0 m
  rampart:   { height: mToTiles(3.5), thickness: 2, material: 'stone',  crenellated: true },  // 3.5 m
  palisade:  { height: mToTiles(2.6), thickness: 1, material: 'timber', posts: true },        // 2.6 m
  fence:     { height: mToTiles(1.1), thickness: 1, material: 'timber', posts: true },        // 1.1 m
  barricade: { height: mToTiles(1.4), thickness: 1, material: 'timber' },                     // 1.4 m
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
