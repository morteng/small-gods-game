// src/world/killing-field.ts
//
// WP-S (Round 6) — the KILLING FIELD: the cleared glacis beyond the ditch. A defended town keeps a
// band outside its wall clear of sightline-blocking vegetation so an approaching force has no cover
// and defenders have a clean field of fire. This is the third element of defensive DEPTH
// (ditch → killing field → curtain).
//
// It REUSES the settlement-wear / trample vegetation-cull machinery (`cullVegetationEntities`): only
// trees/scrub (vegetation + terrain-feature entities) are removed; GRASS is a tile and survives, so
// the ground still reads as open sward. Runs on `open` ring legs only — a `water`/`steep` leg is
// already a clear approach (the water/cliff is the field). Cultivated ground is EXEMPT: farmland
// outside a wall is historically correct, and a bridge-annexed suburb sits across the water (beyond a
// `water` leg) so it is never in a landward `open` band.
//
// Gen-time, World-touching (an entity op) — mirrors `prewarmSettlementWear`. Runs AFTER farmland so
// the `farm_field` exemption sees the tilled fields.

import type { GameMap } from '@/core/types';
import type { World } from '@/world/world';
import { type BarrierRun, defendsForSegment, segmentIndexAt } from '@/world/barrier';
import { cullVegetationEntities } from '@/world/settlement-wear';

/** How far out (tiles) the cleared band reaches beyond the wall — a clean field of fire. */
const KILL_FIELD_REACH = 6;
/** Inner edge (tiles from the wall centreline) — start just clear of the curtain itself. */
const KILL_FIELD_INNER = 1;

/** Only a masonry town wall clears a killing field (matches the ditch rung). */
function earnsKillingField(run: BarrierRun): boolean {
  return run.kind === 'wall' && !!run.crenellated && (run.material === 'stone' || run.material === 'brick');
}

function pathLen(path: [number, number][]): number {
  let s = 0;
  for (let i = 1; i < path.length; i++) s += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
  return s;
}

function frameOnPath(path: [number, number][], t: number): { px: number; py: number; dx: number; dy: number } {
  let acc = 0;
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1], [bx, by] = path[i];
    const len = Math.hypot(bx - ax, by - ay);
    if (len < 1e-9) continue;
    if (t <= acc + len) {
      const u = (t - acc) / len;
      return { px: ax + (bx - ax) * u, py: ay + (by - ay) * u, dx: (bx - ax) / len, dy: (by - ay) / len };
    }
    acc += len;
  }
  const a = path[path.length - 2] ?? path[0], b = path[path.length - 1];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return { px: b[0], py: b[1], dx: (b[0] - a[0]) / len, dy: (b[1] - a[1]) / len };
}

/**
 * The tiles cleared for one wall run's killing field — the outward band on `open` legs, minus
 * cultivated ground. Flat grid indices `y*width+x`. Public for the WP-S test.
 */
export function computeKillingFieldCells(map: GameMap, run: BarrierRun): Set<number> {
  const cells = new Set<number>();
  if (!earnsKillingField(run) || run.path.length < 2 || !run.centroid) return cells;
  const total = pathLen(run.path);
  if (total < 1e-6) return cells;
  const [cxr, cyr] = run.centroid;
  const inner = Math.max(KILL_FIELD_INNER, (run.thickness - 1) / 2 + 0.5);
  const outer = inner + KILL_FIELD_REACH;
  const step = 0.5;
  for (let t = 0; t < total; t += step) {
    if (defendsForSegment(run, segmentIndexAt(run.path, t)) !== 'open') continue;  // clear only landward legs
    const { px, py, dx, dy } = frameOnPath(run.path, t);
    let nx = -dy, ny = dx;
    if (nx * (px - cxr) + ny * (py - cyr) < 0) { nx = -nx; ny = -ny; }
    for (let o = inner; o <= outer + 1e-6; o += step) {
      const x = Math.round(px + nx * o), y = Math.round(py + ny * o);
      const tile = map.tiles[y]?.[x];
      if (!tile) continue;
      if (tile.type === 'farm_field') continue;              // cultivated ground is exempt
      cells.add(y * map.width + x);
    }
  }
  return cells;
}

/**
 * Cull sightline-blocking vegetation from every town wall's killing field. Returns the number of
 * entities culled (for the gen report). Deterministic (pure geometry + a stable entity sweep).
 */
export function clearKillingFields(map: GameMap, world: World): number {
  const runs = map.barrierRuns;
  if (!runs || runs.length === 0 || !world) return 0;
  let culled = 0;
  for (const { run } of runs) {
    if (!earnsKillingField(run)) continue;
    for (const idx of computeKillingFieldCells(map, run)) {
      culled += cullVegetationEntities(world, idx % map.width, (idx / map.width) | 0);
    }
  }
  return culled;
}
