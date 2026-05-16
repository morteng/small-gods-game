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

// HydrologyOptions and findPeaks are the public surface for Task 2.
// Task 3 will add walkDownhill; Task 4 will add generateHydrology.
