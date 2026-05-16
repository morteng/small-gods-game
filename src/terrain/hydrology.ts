/**
 * Drainage-basin hydrology pass.
 *
 * Standard flow-accumulation algorithm:
 *   1. For each land cell, find its drainage target (lowest 4-neighbor strictly
 *      lower than self). -1 if no lower neighbor exists (local minimum or water-adjacent).
 *   2. Sort land cells by elevation descending.
 *   3. Each land cell starts with flow = 1 (one unit of "rain").
 *   4. Process cells in descending elevation order; add each cell's flow to its
 *      drainage target. Flow cascades downhill correctly because higher cells
 *      push their flow before lower cells process.
 *   5. Cells with accumulated flow ≥ riverFlowThreshold become rivers.
 *
 * Operates on the existing TerrainField; does not modify it.
 */

import type { TerrainField, TerrainConfig, HydrologyResult } from '@/core/types';

const DEFAULT_RIVER_FLOW_THRESHOLD = 50;

export interface HydrologyOptions {
  /**
   * Minimum accumulated flow (in "rain units") for a cell to become a river.
   * Default 50 — empirically tuned on a 128×96 map (the game's standard size)
   * to produce a small number of distinct rivers from elevation peaks to water.
   * Tune downward for more (smaller) rivers, upward for fewer (larger) ones.
   * Flow scales roughly with drainage-basin area, so different map sizes may need
   * proportional adjustment.
   */
  riverFlowThreshold?: number;
}

/**
 * Compute drainage flow accumulation and river mask for a terrain field.
 */
export function generateHydrology(
  fields: TerrainField,
  config: TerrainConfig,
  options: HydrologyOptions = {},
): HydrologyResult {
  const { width, height, seaLevel = 0.35 } = config;
  const { elevation } = fields;
  const total = width * height;
  const riverFlowThreshold = options.riverFlowThreshold ?? DEFAULT_RIVER_FLOW_THRESHOLD;

  // 1. Compute drainTo: lowest 4-neighbor strictly lower than self, per land cell.
  //    A water-adjacent land cell drains INTO the water cell (which is lower).
  //    -1 only for true local minima above sea level.
  const drainTo = new Int32Array(total);
  for (let i = 0; i < total; i++) drainTo[i] = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const here = elevation[i];
      if (here < seaLevel) continue; // water — no drainage

      let bestI = -1, bestE = here;
      if (y > 0)          { const ni = i - width; const ne = elevation[ni]; if (ne < bestE) { bestE = ne; bestI = ni; } }
      if (y < height - 1) { const ni = i + width; const ne = elevation[ni]; if (ne < bestE) { bestE = ne; bestI = ni; } }
      if (x > 0)          { const ni = i - 1;     const ne = elevation[ni]; if (ne < bestE) { bestE = ne; bestI = ni; } }
      if (x < width - 1)  { const ni = i + 1;     const ne = elevation[ni]; if (ne < bestE) { bestE = ne; bestI = ni; } }
      drainTo[i] = bestI;
    }
  }

  // 2. Collect land-cell indices and sort by elevation descending.
  const landOrder: number[] = [];
  for (let i = 0; i < total; i++) {
    if (elevation[i] >= seaLevel) landOrder.push(i);
  }
  landOrder.sort((a, b) => elevation[b] - elevation[a]);

  // 3 + 4. Initialise flow to 1 per land cell; cascade downhill in elevation order.
  const flowField = new Float32Array(total);
  for (const i of landOrder) flowField[i] = 1;
  for (const i of landOrder) {
    const target = drainTo[i];
    if (target >= 0) flowField[target] += flowField[i];
  }

  // 5. Mark river tiles where flow accumulation exceeds threshold.
  //    Water tiles (already wet) are never marked: rivers don't overwrite existing water.
  const riverMask = new Uint8Array(total);
  for (let i = 0; i < total; i++) {
    if (elevation[i] < seaLevel) continue;
    if (flowField[i] >= riverFlowThreshold) riverMask[i] = 1;
  }

  return { riverMask, flowField };
}
