/**
 * Drainage-basin hydrology pass.
 *
 * Walks paths downhill from elevation peaks; cells visited by enough paths
 * become rivers. Operates on the existing TerrainField; does not modify it.
 *
 * Algorithm: see docs/superpowers/plans/2026-05-16-terrain-phase-1-drainage-rivers.md
 */

import type { TerrainField, TerrainConfig, HydrologyResult } from '@/core/types';

export interface HydrologyOptions {
  /** Minimum elevation to start a river. Default 0.7. */
  peakThreshold?: number;
  /** Minimum flow count to mark a tile as river. Default 3. */
  riverFlowThreshold?: number;
  /** Cap on number of rivers (highest peaks first). Default 32. */
  maxRivers?: number;
  /** Skip paths shorter than this. Default 4. */
  minRiverLength?: number;
}

/**
 * Find local elevation maxima ≥ peakThreshold.
 * A cell is a local max if its elevation is strictly greater than all 4 cardinal neighbors.
 * Returns peaks sorted by elevation descending, capped at maxRivers.
 */
export function findPeaks(
  fields: TerrainField,
  config: TerrainConfig,
  options: HydrologyOptions = {},
): Array<{ x: number; y: number }> {
  const { width, height } = config;
  const { elevation } = fields;
  const peakThreshold = options.peakThreshold ?? 0.7;
  const maxRivers = options.maxRivers ?? 32;

  const peaks: Array<{ x: number; y: number; e: number }> = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const e = elevation[i];
      if (e < peakThreshold) continue;

      // Check 4 cardinal neighbors — must be strictly higher than all of them.
      const n  = y > 0          ? elevation[i - width] : -Infinity;
      const s  = y < height - 1 ? elevation[i + width] : -Infinity;
      const w  = x > 0          ? elevation[i - 1]     : -Infinity;
      const ee = x < width - 1  ? elevation[i + 1]     : -Infinity;
      if (e > n && e > s && e > w && e > ee) {
        peaks.push({ x, y, e });
      }
    }
  }

  peaks.sort((a, b) => b.e - a.e);
  return peaks.slice(0, maxRivers).map(({ x, y }) => ({ x, y }));
}

/**
 * Walk strictly downhill from (startX, startY), stepping to the lowest 4-neighbor
 * each iteration. Stops when:
 *   - the current cell is water (elevation < seaLevel), OR
 *   - no neighbor is strictly lower than the current cell, OR
 *   - we step off the map (cannot happen given bounded neighbors, but guarded anyway).
 *
 * Returns the path (including start). If the start is already water,
 * returns just [start].
 *
 * A safety cap of (width + height) * 2 steps prevents pathological loops.
 */
export function walkDownhill(
  startX: number,
  startY: number,
  fields: TerrainField,
  config: TerrainConfig,
): Array<{ x: number; y: number }> {
  const { width, height, seaLevel = 0.35 } = config;
  const { elevation } = fields;
  const maxSteps = (width + height) * 2;

  const path: Array<{ x: number; y: number }> = [{ x: startX, y: startY }];
  let x = startX, y = startY;

  for (let step = 0; step < maxSteps; step++) {
    const here = elevation[y * width + x];
    if (here < seaLevel) break; // reached water — stop

    // Find lowest strictly-lower 4-neighbor.
    let bestX = -1, bestY = -1, bestE = here;
    const neighbors: Array<[number, number]> = [
      [x, y - 1], [x, y + 1], [x - 1, y], [x + 1, y],
    ];
    for (const [nx, ny] of neighbors) {
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const ne = elevation[ny * width + nx];
      if (ne < bestE) { bestE = ne; bestX = nx; bestY = ny; }
    }
    if (bestX < 0) break; // no lower neighbor — local minimum
    x = bestX; y = bestY;
    path.push({ x, y });
  }

  return path;
}

// HydrologyOptions, findPeaks, walkDownhill are the public surface for Task 3.
// Task 4 will add generateHydrology.
