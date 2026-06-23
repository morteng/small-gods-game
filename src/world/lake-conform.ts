// src/world/lake-conform.ts
//
// DIR-A — "placed/moved water features conform the terrain." A lake is not just a
// recoloured patch of tiles: a body of standing water implies a shape of GROUND. When
// an author drops a lake (or drags one across the connectome), the terrain should
// adjust so the hydrology "works out" — the basin holds water, its banks grade out of
// it, and it drains downhill through an outlet instead of sitting endorheic.
//
// This is the SAME pattern as a building pad or a motte owning its terrain: a feature
// emits deformations into the shared channel (`terrain-deformation.ts`). Three brushes
// per lake, all DERIVED from the (possibly edited) water network + the seed terrain —
// nothing persisted, re-derives identically:
//
//   1. BASIN  — level the lake's footprint to a water-holding plateau a fixed depth
//               below the spill lip (`footprintLevelDeformation`, op 'level'). The
//               brush feather grades the rim up to the surrounding ground.
//   2. SPILL  — find the lowest cell on the lake's shore ring: that is where water
//               would overflow (the natural outlet, and the level the lake fills to).
//   3. OUTLET — carve a shallow channel by steepest descent from the spill cell so the
//               overflow has a downhill path away from the basin (`polylineDeformation`,
//               op 'carve'). Guarantees the basin is not a closed sink.
//
// Pure + deterministic: cells visited in index order, steepest-descent ties broken by
// lowest cell index, no Math.random. Lives in `src/world/` (world-owned, like the other
// deformation producers); the studio swaps these sources on a connectome edit.
import type { GameMap } from '@/core/types';
import {
  footprintLevelDeformation,
  polylineDeformation,
  baseHeightAt,
  type Deformation,
} from '@/world/terrain-deformation';
import type { WaterBody, WaterNetwork, Pt } from '@/terrain/river-network';

/** Source tags so the studio can swap a lake-conform set wholesale on an edit. */
export const LAKE_BASIN_SOURCE = 'lake:basin';
export const LAKE_OUTLET_SOURCE = 'lake:spillway';

export interface LakeConformParams {
  /** Basin floor depth (metres) below the spill lip — the water-holding volume. */
  basinDepthM: number;
  /** Rim grade width (tiles) the basin plateau feathers up to the surrounding ground. */
  rimFeatherTiles: number;
  /** Max length (tiles) of the carved outlet channel before it gives up. */
  outletLengthTiles: number;
  /** Outlet channel carve depth (metres) below the ground it threads. */
  outletDepthM: number;
  /** Outlet channel half-width (tiles). */
  outletHalfWidth: number;
}

export const DEFAULT_LAKE_CONFORM: LakeConformParams = {
  basinDepthM: 2.5,
  rimFeatherTiles: 2.5,
  outletLengthTiles: 24,
  outletDepthM: 1.2,
  outletHalfWidth: 0.8,
};

const NB4: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/**
 * The shore RING of a lake: cells not in the body but 4-adjacent to it, in bounds.
 * Returned as cell indices in ascending order (determinism).
 */
function shoreRing(lake: WaterBody, W: number, H: number): number[] {
  const body = new Set(lake.cells);
  const ring = new Set<number>();
  for (const c of lake.cells) {
    const cx = c % W;
    const cy = (c / W) | 0;
    for (const [dx, dy] of NB4) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const n = ny * W + nx;
      if (!body.has(n)) ring.add(n);
    }
  }
  return [...ring].sort((a, b) => a - b);
}

/**
 * The lake's SPILL cell — the lowest-elevation cell on its shore ring (where water
 * overflows). Ties broken by lowest cell index. Returns null for a degenerate lake with
 * no ring (whole-map body). The spill HEIGHT is the level the lake fills to.
 */
function spillCell(map: GameMap, lake: WaterBody, W: number, H: number): { cell: number; height: number } | null {
  const ring = shoreRing(lake, W, H);
  if (!ring.length) return null;
  let best = ring[0];
  let bestH = baseHeightAt(map, best % W, (best / W) | 0);
  for (const c of ring) {
    const hgt = baseHeightAt(map, c % W, (c / W) | 0);
    if (hgt < bestH) {
      bestH = hgt;
      best = c;
    }
  }
  return { cell: best, height: bestH };
}

/**
 * Steepest-descent walk from `start` over BASE terrain, returning the polyline of cell
 * centres (tile coords). Stops at `maxLen` cells, at the map edge, or where no strictly
 * lower 4-neighbour exists (a local minimum / the sea). Ties broken by lowest index. The
 * carved outlet follows this so the overflow keeps heading downhill.
 */
function descentPath(map: GameMap, start: number, W: number, H: number, maxLen: number): Pt[] {
  const path: Pt[] = [];
  const seen = new Set<number>();
  let cur = start;
  for (let step = 0; step < maxLen; step++) {
    if (seen.has(cur)) break;
    seen.add(cur);
    const cx = cur % W;
    const cy = (cur / W) | 0;
    path.push({ x: cx, y: cy });
    let next = -1;
    let nextH = baseHeightAt(map, cx, cy);
    for (const [dx, dy] of NB4) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const hgt = baseHeightAt(map, nx, ny);
      if (hgt < nextH) {
        nextH = hgt;
        next = ny * W + nx;
      }
    }
    if (next < 0) break; // local minimum — outlet has reached lower ground / water
    cur = next;
  }
  return path;
}

/**
 * Pure: a lake body → the deformations that make the terrain hold it. The basin is
 * levelled to `spillHeight − basinDepthM`; the outlet is carved by steepest descent from
 * the spill cell. Returns [] for a degenerate lake. `params` tunes depth/grade/length.
 */
export function buildLakeConformForBody(
  map: GameMap,
  lake: WaterBody,
  W: number,
  H: number,
  params: LakeConformParams = DEFAULT_LAKE_CONFORM,
): Deformation[] {
  if (!lake.cells.length) return [];
  const out: Deformation[] = [];
  const spill = spillCell(map, lake, W, H);
  // Spill height defines the fill line; without a ring fall back to the body's own min.
  let lipH = spill?.height;
  if (lipH === undefined) {
    lipH = Infinity;
    for (const c of lake.cells) lipH = Math.min(lipH, baseHeightAt(map, c % W, (c / W) | 0));
  }
  const floorH = lipH - params.basinDepthM;

  // 1+2) the water-holding basin: lower the footprint to a flat floor below the spill
  // lip. Op 'sink' so dry land is carved down to hold water but an already-deeper natural
  // basin is left alone (filling in a deep lake would be wrong).
  out.push(
    footprintLevelDeformation({
      id: `lake:basin:${lake.id}`,
      source: LAKE_BASIN_SOURCE,
      cells: lake.cells,
      gridWidth: W,
      target: floorH,
      feather: params.rimFeatherTiles,
      op: 'sink',
    }),
  );

  // 3) the outlet spillway — a carved descent from the spill cell so the basin drains.
  if (spill) {
    const line = descentPath(map, spill.cell, W, H, params.outletLengthTiles);
    if (line.length >= 2) {
      out.push(
        polylineDeformation({
          id: `lake:spillway:${lake.id}`,
          source: LAKE_OUTLET_SOURCE,
          points: line,
          halfWidth: params.outletHalfWidth,
          feather: 1,
          amount: params.outletDepthM,
          op: 'carve',
        }),
      );
    }
  }
  return out;
}

/**
 * Pure: every lake in a (possibly edited) water network → its conform deformations. The
 * seam the studio's drag-to-move re-carve uses (swap LAKE_BASIN_SOURCE/LAKE_OUTLET_SOURCE
 * for the edited net's output). Determinism: lakes processed in array order.
 */
export function buildLakeConformDeformations(
  map: GameMap,
  net: WaterNetwork,
  params: LakeConformParams = DEFAULT_LAKE_CONFORM,
): Deformation[] {
  const out: Deformation[] = [];
  for (const lake of net.lakes) {
    out.push(...buildLakeConformForBody(map, lake, net.width, net.height, params));
  }
  return out;
}
