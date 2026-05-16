/**
 * Drainage-basin hydrology pass.
 *
 *   1. Pit-fill (Barnes 2014 priority-flood + epsilon): compute a "filled"
 *      elevation field W where every land cell has a strictly-descending
 *      path to a water/edge cell. Real terrain (especially after erosion)
 *      is full of small closed basins; without filling, flow accumulation
 *      dead-ends at every pit and rivers come out as scattered fragments.
 *   2. Drainage targets follow W. Every land cell drains to one neighbour
 *      and the chain reaches water by construction.
 *   3. Accumulate flow (1 rain unit per land cell) in W-descending order.
 *   4. Mark cells whose flow ≥ threshold as river. Contiguous by construction.
 *
 * Operates on the existing TerrainField; does not modify it.
 */

import type { TerrainField, TerrainConfig, HydrologyResult } from '@/core/types';

const DEFAULT_RIVER_FLOW_THRESHOLD = 500;
// Pit-fill increment per cell of flat-region travel. 1e-5 in normalized [0,1]
// elevation is well above Float32 rounding noise across the longest possible
// flat run (~map diagonal), and is far too small to be visible in terrain.
const PIT_FILL_EPSILON = 1e-5;

export interface HydrologyOptions {
  /**
   * Minimum accumulated flow (in "rain units") for a cell to become a river.
   * Default 500 — empirically tuned on the standard 128×96 map to give
   * 250-300 river cells (a couple of distinct river systems plus tributaries).
   * Flow accumulates over the entire upstream drainage area, so larger maps
   * push more flow through main channels; scale the threshold roughly with
   * area when changing map size (~4% of total cells is a useful starting
   * point — a value below that gives marshlands, above it gives one trunk
   * river or none).
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

  // 1. Pit-fill via priority-flood (Barnes 2014 §4.08).
  //    Seeds: water cells (true drainage outlets) and map-edge cells (treated
  //    as off-map drains; otherwise a fully enclosed map fills as one big pit).
  //    A flat-array min-heap keyed on (W, insertion-order) processes seeds in
  //    ascending W, raising each unvisited neighbour to max(elevation,
  //    parentW + ε). The result W has no spurious local minima inland.
  const W = new Float32Array(total);
  const closed = new Uint8Array(total);
  const heapKey = new Float32Array(total + 8);
  const heapOrder = new Int32Array(total + 8);
  const heapVal = new Int32Array(total + 8);
  let heapSize = 0;
  let insertCounter = 0;

  const heapLess = (i: number, j: number): boolean =>
    heapKey[i] !== heapKey[j] ? heapKey[i] < heapKey[j] : heapOrder[i] < heapOrder[j];

  const heapSwap = (i: number, j: number): void => {
    const tk = heapKey[i]; heapKey[i] = heapKey[j]; heapKey[j] = tk;
    const to = heapOrder[i]; heapOrder[i] = heapOrder[j]; heapOrder[j] = to;
    const tv = heapVal[i]; heapVal[i] = heapVal[j]; heapVal[j] = tv;
  };

  const heapPush = (key: number, val: number): void => {
    let i = heapSize++;
    heapKey[i] = key;
    heapOrder[i] = insertCounter++;
    heapVal[i] = val;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!heapLess(i, parent)) break;
      heapSwap(i, parent);
      i = parent;
    }
  };

  const heapPop = (): number => {
    const val = heapVal[0];
    heapSize--;
    if (heapSize > 0) {
      heapKey[0] = heapKey[heapSize];
      heapOrder[0] = heapOrder[heapSize];
      heapVal[0] = heapVal[heapSize];
      let i = 0;
      while (true) {
        const left = 2 * i + 1;
        const right = 2 * i + 2;
        let smallest = i;
        if (left < heapSize && heapLess(left, smallest)) smallest = left;
        if (right < heapSize && heapLess(right, smallest)) smallest = right;
        if (smallest === i) break;
        heapSwap(i, smallest);
        i = smallest;
      }
    }
    return val;
  };

  // Seed: water cells and the entire map border.
  for (let i = 0; i < total; i++) {
    if (elevation[i] < seaLevel) {
      W[i] = elevation[i];
      closed[i] = 1;
      heapPush(elevation[i], i);
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (y !== 0 && y !== height - 1 && x !== 0 && x !== width - 1) continue;
      const i = y * width + x;
      if (closed[i]) continue;
      W[i] = elevation[i];
      closed[i] = 1;
      heapPush(elevation[i], i);
    }
  }

  while (heapSize > 0) {
    const c = heapPop();
    const cx = c % width;
    const cy = (c / width) | 0;
    const cW = W[c];
    // Visit 4 neighbours. Raise W to max(its elevation, cW + ε), mark closed,
    // push. The +ε guarantees strict descent across formerly-flat regions.
    if (cy > 0) {
      const n = c - width;
      if (!closed[n]) {
        W[n] = elevation[n] > cW + PIT_FILL_EPSILON ? elevation[n] : cW + PIT_FILL_EPSILON;
        closed[n] = 1;
        heapPush(W[n], n);
      }
    }
    if (cy < height - 1) {
      const n = c + width;
      if (!closed[n]) {
        W[n] = elevation[n] > cW + PIT_FILL_EPSILON ? elevation[n] : cW + PIT_FILL_EPSILON;
        closed[n] = 1;
        heapPush(W[n], n);
      }
    }
    if (cx > 0) {
      const n = c - 1;
      if (!closed[n]) {
        W[n] = elevation[n] > cW + PIT_FILL_EPSILON ? elevation[n] : cW + PIT_FILL_EPSILON;
        closed[n] = 1;
        heapPush(W[n], n);
      }
    }
    if (cx < width - 1) {
      const n = c + 1;
      if (!closed[n]) {
        W[n] = elevation[n] > cW + PIT_FILL_EPSILON ? elevation[n] : cW + PIT_FILL_EPSILON;
        closed[n] = 1;
        heapPush(W[n], n);
      }
    }
  }

  // 2. drainTo: lowest 4-neighbour by filled elevation. Every land cell has
  //    at least one strictly-lower neighbour in W (toward water/edge), so
  //    drainTo[i] is always ≥ 0 for land cells.
  const drainTo = new Int32Array(total);
  for (let i = 0; i < total; i++) drainTo[i] = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (elevation[i] < seaLevel) continue;
      const here = W[i];
      let bestI = -1, bestE = here;
      if (y > 0)          { const ni = i - width; const ne = W[ni]; if (ne < bestE) { bestE = ne; bestI = ni; } }
      if (y < height - 1) { const ni = i + width; const ne = W[ni]; if (ne < bestE) { bestE = ne; bestI = ni; } }
      if (x > 0)          { const ni = i - 1;     const ne = W[ni]; if (ne < bestE) { bestE = ne; bestI = ni; } }
      if (x < width - 1)  { const ni = i + 1;     const ne = W[ni]; if (ne < bestE) { bestE = ne; bestI = ni; } }
      drainTo[i] = bestI;
    }
  }

  // 3. Sort land cells by W descending and cascade flow.
  //    Sorting by W (not raw elevation) matches the drainage direction; using
  //    raw elevation here would visit cells before their donors had finished
  //    contributing wherever pit-fill rerouted drainage uphill in real terms.
  const landOrder: number[] = [];
  for (let i = 0; i < total; i++) {
    if (elevation[i] >= seaLevel) landOrder.push(i);
  }
  landOrder.sort((a, b) => W[b] - W[a]);

  const flowField = new Float32Array(total);
  for (const i of landOrder) flowField[i] = 1;
  for (const i of landOrder) {
    const target = drainTo[i];
    if (target >= 0) flowField[target] += flowField[i];
  }

  // 4. Mark river tiles where flow accumulation exceeds threshold.
  //    Water tiles (already wet) are never marked.
  const riverMask = new Uint8Array(total);
  for (let i = 0; i < total; i++) {
    if (elevation[i] < seaLevel) continue;
    if (flowField[i] >= riverFlowThreshold) riverMask[i] = 1;
  }

  return { riverMask, flowField };
}
