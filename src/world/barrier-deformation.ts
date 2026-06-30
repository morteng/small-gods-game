// src/world/barrier-deformation.ts
//
// Walls → terrain CARVE (stepped foundation footing). Like roads, rivers and building pads,
// a defensive wall is "a thing to the terrain": a long curtain crossing a slope wants a level
// footing under each stretch so its lit chunks sit FLUSH on the ground instead of floating on
// the downhill side / burying on the uphill one (the wall render places each ≤4-tile chunk at
// one foot-z, so a single sprite can't follow a grade within itself).
//
// The footing is STEPPED, not a single platform: each ~4-tile span along the path becomes one
// gentle `level` brush toward the LOCAL mean base elevation — so the foundation terraces with
// the landform (believable for a real wall) and never flattens a whole ring. The step length
// matches the render chunk, so each chunk lands on its own level step. On the flat POI sites
// where settlements actually sit, the local mean ≈ the ground, so the carve is near-zero —
// the effect only shows where a wall genuinely crosses a slope.
//
// Determinism & save-safety: foundations derive from `map.barrierRuns` (the runs worldgen
// committed, persisted verbatim on the map), NOT from live World entities — so the composed
// heightfield stays a PURE function of `map` and re-derives identically on load. Reads BASE
// height (not the composed field) for each target, so a footing never feeds back on itself.

import type { GameMap } from '@/core/types';
import type { BarrierRun } from '@/world/barrier';
import { polylineDeformation, type Deformation } from '@/world/terrain-deformation';
import { heightMetresAt } from '@/world/heightfield';

/** Foundation STEP length (tiles) — matches the render chunk so each lit chunk sits on a step. */
const SPAN_TILES = 4;
/** Taper from the levelled footing back to untouched terrain, in tiles. A touch wider than
 *  the wall is thick so a steep footing scarp blends gently into the ground rather than
 *  reading as a cliff at the edge; still under the building pad's 1.5 so it stays local. */
const FEATHER = 1.2;
/** Carve STRENGTH: pull only 85 % of the way to the local mean, so the footing grades the
 *  ground gently rather than stamping a hard shelf. */
const PEAK = 0.85;
/** Foundations level BELOW pads (25), roads (30) and rivers (40): a road through a gate, or a
 *  river the wall meets, still rules its own corridor. */
const PRIORITY = 20;

/** Only substantial barriers get a carved footing. A hedge / light fence / barricade follows
 *  the ground naturally (and carving under foliage or a paling reads wrong); a masonry wall,
 *  palisade or rampart wants a level footing so its chunks don't float on a slope. */
function carvesFoundation(run: BarrierRun): boolean {
  return run.kind === 'wall' || run.kind === 'palisade' || run.kind === 'rampart';
}

/** Mean BASE elevation (metres) sampled at a span's endpoints + midpoint. */
function meanBase(map: GameMap, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  return (heightMetresAt(map, a.x, a.y) + heightMetresAt(map, m.x, m.y) + heightMetresAt(map, b.x, b.y)) / 3;
}

/** Split a run path into ~SPAN_TILES world-space spans (2 points each). */
function spans(path: [number, number][]): [{ x: number; y: number }, { x: number; y: number }][] {
  const out: [{ x: number; y: number }, { x: number; y: number }][] = [];
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1], [bx, by] = path[i];
    const len = Math.hypot(bx - ax, by - ay);
    if (len <= 1e-6) continue;
    const n = Math.max(1, Math.ceil(len / SPAN_TILES));
    for (let k = 0; k < n; k++) {
      const t0 = k / n, t1 = (k + 1) / n;
      out.push([
        { x: ax + (bx - ax) * t0, y: ay + (by - ay) * t0 },
        { x: ax + (bx - ax) * t1, y: ay + (by - ay) * t1 },
      ]);
    }
  }
  return out;
}

/**
 * Pure: a map → the foundation-footing deformations its walls imply (one gentle `level` brush
 * per ~4-tile span of every substantial barrier, target = the local mean base height). Empty
 * when the map has no carved barriers.
 */
export function buildBarrierDeformations(map: GameMap): Deformation[] {
  const runs = map.barrierRuns;
  if (!runs || runs.length === 0) return [];
  const out: Deformation[] = [];
  for (const { id, run } of runs) {
    if (!carvesFoundation(run) || run.path.length < 2) continue;
    const halfWidth = Math.max(0.6, run.thickness / 2 + 0.4);
    spans(run.path).forEach(([a, b], k) => {
      out.push(polylineDeformation({
        id: `wall:${id}:${k}`,
        source: 'wall:foundation',
        points: [a, b],
        halfWidth,
        amount: 0,
        op: 'level',
        target: meanBase(map, a, b),
        feather: FEATHER,
        peak: PEAK,
        priority: PRIORITY,
      }));
    });
  }
  return out;
}

/** Count of carved barriers — a cheap signature for the deformation cache key so footings
 *  invalidate if the persisted barrier set changes. */
export function barrierFoundationCount(map: GameMap): number {
  return (map.barrierRuns ?? []).reduce((n, b) => n + (carvesFoundation(b.run) ? 1 : 0), 0);
}
