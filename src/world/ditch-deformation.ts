// src/world/ditch-deformation.ts
//
// WP-S (Round 6) — the DITCH: a shallow dry ditch carved into the terrain just OUTSIDE a town wall,
// the first element of defensive DEPTH (ditch → cleared killing field → curtain). Like the wall's
// own foundation footing, roads and river incision, it is a producer on the SHARED terrain-
// deformation channel (`heightAt = base ⊕ deformations`) — one `carve` brush over the ditch cell
// set, so it composes with everything else and re-derives identically on load.
//
// Hard constraints (the ditch must READ as a real defence, not a bug):
//   • town-wall rung only (a masonry curtain earns a ditch; a palisade/hedge does not);
//   • OUTSIDE the curtain only — offset a tile clear of the wall, never under it;
//   • CAUSEWAY across every real gate — the approach road crosses on solid ground, no ditch;
//   • never under water (WATER is the wall on those legs — WP-R's `water` segments), a road, a
//     building footprint, or cultivated farmland; extramural suburb development (its roads/buildings)
//     is skipped cell-by-cell by those same tile tests;
//   • SHALLOW (≈1 m) — an NPC walks through it; it is a deformation, not a collision object.
//
// Determinism & save-safety: derives purely from `map` (barrier runs + tiles), like
// `buildBarrierDeformations`, so the composed heightfield stays a pure function of the map.

import type { GameMap } from '@/core/types';
import {
  type BarrierRun, defendsForSegment, segmentIndexAt, gatePoint,
} from '@/world/barrier';
import { footprintCarveDeformation, type Deformation } from '@/world/terrain-deformation';
import { WATER_TYPES } from '@/core/constants';

/** Dirt/stone road + bridge tile types the ditch must never break — matches the placer's set. */
const ROAD_TYPES: ReadonlySet<string> = new Set(['dirt_road', 'stone_road', 'bridge']);
/** Ditch depth (metres): shallow enough to walk (NPC safety) yet reads as a real ditch. */
const DITCH_DEPTH_M = 1.0;
/** Band width (tiles) of the ditch, measured radially outward. */
const DITCH_WIDTH = 2;
/** Gap (tiles) between the wall centreline and the inner edge of the ditch, on top of half-thickness. */
const DITCH_GAP = 1;
/** Feather (tiles) of the carve back to untouched ground at the band edges. Must span
 *  SEVERAL integer tiles: the heightfield samples the carve mask at tile centres, so a
 *  feather < 1 tile is inert (every off-footprint cell is ≥1 tile away → snaps to 0) and
 *  the ditch collapses to a 1 m cliff between adjacent tiles → visible diamond faceting in
 *  front of the wall. At 3 tiles the wall grades ~0.67/0.33 m over successive cells. */
const DITCH_FEATHER = 3;

/** Only a masonry town wall earns a ditch. */
function ditchesEarned(run: BarrierRun): boolean {
  return run.kind === 'wall' && !!run.crenellated && (run.material === 'stone' || run.material === 'brick');
}

function pathLen(path: [number, number][]): number {
  let s = 0;
  for (let i = 1; i < path.length; i++) s += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
  return s;
}

/** Point + along-unit direction at path distance `t`. */
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
 * The ditch cell set for one wall run: an outward band offset clear of the curtain, minus water,
 * roads, buildings, farmland, water-defended legs, and a causeway around each real gate. Returns
 * flat grid indices `y*width+x`. Public for the WP-S test (assert no building/road/suburb hit).
 */
export function computeDitchCells(map: GameMap, run: BarrierRun): Set<number> {
  const out = new Set<number>();
  if (!ditchesEarned(run) || run.path.length < 2 || !run.centroid) return out;
  const total = pathLen(run.path);
  if (total < 1e-6) return out;
  const [cxr, cyr] = run.centroid;
  const startOff = Math.max(DITCH_GAP, (run.thickness - 1) / 2 + DITCH_GAP);
  const endOff = startOff + DITCH_WIDTH;

  // Causeway centres: every real gate's world point + a clear radius the road passes through.
  const gates = run.gates.filter((g) => g.kind !== 'gap');
  const gatePts = gates.map((g) => {
    const [gx, gy] = gatePoint(run, g);
    return { gx, gy, r: g.width / 2 + endOff + 1 };
  });

  const inCauseway = (x: number, y: number): boolean =>
    gatePts.some(({ gx, gy, r }) => Math.hypot(x - gx, y - gy) <= r);

  const step = 0.5;
  for (let t = 0; t < total; t += step) {
    const i = segmentIndexAt(run.path, t);
    if (defendsForSegment(run, i) === 'water') continue;     // the water IS the wall — no ditch
    const { px, py, dx, dy } = frameOnPath(run.path, t);
    // Outward normal (perpendicular to travel, pointing away from the ring centre).
    let nx = -dy, ny = dx;
    if (nx * (px - cxr) + ny * (py - cyr) < 0) { nx = -nx; ny = -ny; }
    for (let o = startOff; o <= endOff + 1e-6; o += step) {
      const x = Math.round(px + nx * o), y = Math.round(py + ny * o);
      const tile = map.tiles[y]?.[x];
      if (!tile) continue;
      if (WATER_TYPES.has(tile.type)) continue;              // never carve water
      if (ROAD_TYPES.has(tile.type)) continue;               // never break a road
      if (tile.type === 'farm_field') continue;              // cultivated ground is exempt
      if (tile.walkable === false) continue;                 // building footprints (+ curtain cells)
      if (inCauseway(x, y)) continue;                        // clean causeway across each gate
      out.add(y * map.width + x);
    }
  }
  return out;
}

/**
 * Pure: a map → the ditch carve deformations its town walls imply (one `carve` brush per walled
 * settlement, over the ditch cell set). Empty when no wall earns a ditch or every band cell is
 * excluded (a fully water-fronted / suburb-wrapped ring).
 */
export function buildDitchDeformations(map: GameMap): Deformation[] {
  const runs = map.barrierRuns;
  if (!runs || runs.length === 0) return [];
  const out: Deformation[] = [];
  for (const { id, run } of runs) {
    if (!ditchesEarned(run)) continue;
    const cells = computeDitchCells(map, run);
    if (cells.size === 0) continue;
    out.push(footprintCarveDeformation({
      id: `ditch:${id}`,
      source: 'wall:ditch',
      cells,
      gridWidth: map.width,
      amount: DITCH_DEPTH_M,
      feather: DITCH_FEATHER,
      priority: 72,     // below river incision authority, above the wall footing level
    }));
  }
  return out;
}

/** Count of walls that earn a ditch — a cheap signature contribution for the deformation cache key. */
export function ditchWallCount(map: GameMap): number {
  return (map.barrierRuns ?? []).reduce((n, b) => n + (ditchesEarned(b.run) ? 1 : 0), 0);
}
