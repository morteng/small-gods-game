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
import { WaterType } from '@/core/types';

export const DEFAULT_RIVER_FLOW_THRESHOLD = 560;
// The cell count the default threshold was tuned on (128×96). A FIXED threshold on a much
// larger map promotes every minor gully to a river — a 384×272 island webs over. But the
// scaling must be GENTLE: peak flow accumulates over upstream drainage LENGTH, not area, and
// an island drains quickly to the surrounding sea, so its max accumulation is bounded. Linear
// area-scaling (×8.5 here) overshoots to ZERO rivers; scaling by the LINEAR dimension
// (√area) tracks drainage length and lands a few trunk rivers + tributaries. Floored at the
// tuned value so small maps stay byte-identical.
const RIVER_THRESHOLD_REF_CELLS = 128 * 96;

/** The area-scaled river-flow threshold for a map of `totalCells` — scales with the LINEAR
 *  map dimension (√cells), tracking drainage length rather than area. */
export function areaScaledRiverThreshold(totalCells: number): number {
  return Math.max(DEFAULT_RIVER_FLOW_THRESHOLD, DEFAULT_RIVER_FLOW_THRESHOLD * Math.sqrt(totalCells / RIVER_THRESHOLD_REF_CELLS));
}
// Headwater taper: a river is extended UPSTREAM (as a thin source trickle) down to
// this fraction of the river threshold, so a stream visibly ORIGINATES from a thin
// headwater high on the slope and grows downstream — instead of "popping out of the
// ground" at full channel width the instant flow crosses the threshold. Only cells
// whose drainage actually reaches a real river downstream are promoted, so isolated
// gullies that never become a river are NOT turned into rivers.
const HEADWATER_FLOW_FRACTION = 0.4;
// Minimum filled depth (normalized elevation) for a cell to count as a lake.
// Pit-fill raises flat runs by PIT_FILL_EPSILON per cell, so a long flat valley
// accumulates a small W−elevation gap that is NOT a lake. A genuine basin is
// filled far deeper; 0.01 (≈0.5 m at TERRAIN_RELIEF_M) sits well above the
// longest plausible ε run (~map-diagonal × 1e-5).
const LAKE_MIN_FILL = 0.01;
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
  // Explicit override wins; otherwise scale the tuned default by map area (a fixed
  // threshold on a large map over-rivers — see areaScaledRiverThreshold).
  const riverFlowThreshold = options.riverFlowThreshold ?? areaScaledRiverThreshold(total);

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

  // 4. Mark river tiles where flow reaches the threshold, then TAPER each river up to
  //    a thin headwater source. We do NOT simply lower the threshold (that recruits
  //    lateral cells draining INTO the channel and bloats its width); instead, from
  //    every SOURCE cell (a river whose dominant upstream donor isn't already a river)
  //    we walk upstream along the single largest-flow donor, marking a ONE-cell trickle
  //    until the flow falls below the headwater floor. Result: every river originates
  //    as a thin source high on the slope and grows downstream, while the channel keeps
  //    its flow-derived width (no blocky widening).
  const riverMask = new Uint8Array(total);
  for (let i = 0; i < total; i++) {
    if (elevation[i] >= seaLevel && flowField[i] >= riverFlowThreshold) riverMask[i] = 1;
  }
  // A trickle must carry more flow than a lone ridge cell (1), so headwaters stop just
  // shy of the drainage divide rather than painting every ridgetop.
  const headwaterFloor = Math.max(2, riverFlowThreshold * HEADWATER_FLOW_FRACTION);
  // The upstream donor (4-neighbour draining into c) carrying the most flow, or -1.
  const dominantDonor = (c: number): number => {
    const cx = c % width, cy = (c / width) | 0;
    let best = -1, bestF = -1;
    const tryN = (n: number): void => {
      if (drainTo[n] === c && flowField[n] > bestF) { bestF = flowField[n]; best = n; }
    };
    if (cy > 0) tryN(c - width);
    if (cy < height - 1) tryN(c + width);
    if (cx > 0) tryN(c - 1);
    if (cx < width - 1) tryN(c + 1);
    return best;
  };
  const trunk = riverMask.slice();   // sources are found against the threshold rivers only
  for (let i = 0; i < total; i++) {
    if (!trunk[i]) continue;
    const up = dominantDonor(i);
    if (up >= 0 && trunk[up]) continue;        // not a source — its main donor is already a river
    let c = dominantDonor(i), guard = 0;       // a source: trace the trickle upslope
    while (c >= 0 && elevation[c] >= seaLevel && flowField[c] >= headwaterFloor
           && !riverMask[c] && guard++ < total) {
      riverMask[c] = 1;
      c = dominantDonor(c);
    }
  }

  // ── Water S0: derive the render-facing water data model from W / drainTo. ──

  // 5. Ocean = below sea level AND connected to the map border. Flood 4-neighbour
  //    through sub-sea cells from border seeds; enclosed sub-sea basins stay lakes.
  const oceanMask = new Uint8Array(total);
  const floodStack: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (y !== 0 && y !== height - 1 && x !== 0 && x !== width - 1) continue;
      const i = y * width + x;
      if (elevation[i] < seaLevel && !oceanMask[i]) { oceanMask[i] = 1; floodStack.push(i); }
    }
  }
  while (floodStack.length > 0) {
    const c = floodStack.pop()!;
    const cx = c % width;
    const cy = (c / width) | 0;
    const tryN = (n: number): void => {
      if (!oceanMask[n] && elevation[n] < seaLevel) { oceanMask[n] = 1; floodStack.push(n); }
    };
    if (cy > 0) tryN(c - width);
    if (cy < height - 1) tryN(c + width);
    if (cx > 0) tryN(c - 1);
    if (cx < width - 1) tryN(c + 1);
  }

  // 6. Strahler order over the drainage forest (each land cell → one parent via
  //    drainTo; roots = outlets). Process headwaters→outlet (W descending, the
  //    existing landOrder): finalize a cell's order from accumulated donor orders,
  //    then contribute it to its target. Two equal-order donors increment.
  const strahler = new Uint8Array(total);
  const maxIn = new Uint8Array(total);
  const cntMax = new Uint8Array(total);
  for (const i of landOrder) { // descending W = headwaters first
    const o = maxIn[i] === 0 ? 1 : (cntMax[i] >= 2 ? maxIn[i] + 1 : maxIn[i]);
    strahler[i] = o > 255 ? 255 : o;
    const t = drainTo[i];
    if (t >= 0) {
      if (strahler[i] > maxIn[t]) { maxIn[t] = strahler[i]; cntMax[t] = 1; }
      else if (strahler[i] === maxIn[t] && cntMax[t] < 255) { cntMax[t]++; }
    }
  }

  // 7. Per-cell classification + surface height + flow vectors + width.
  //    Precedence ocean > lake > river. LAKE_MIN_FILL keeps flat-region ε
  //    accumulation (pit-fill raises flats by tiny increments) from reading as a
  //    lake — a genuine basin is filled far deeper than the longest ε run.
  const surfaceW = new Float32Array(total).fill(-1);
  const waterMask = new Uint8Array(total);
  const waterType = new Uint8Array(total);
  const flowDirX = new Float32Array(total);
  const flowDirY = new Float32Array(total);
  const widthArr = new Float32Array(total);
  for (let i = 0; i < total; i++) {
    const belowSea = elevation[i] < seaLevel;
    const standingFill = W[i] - elevation[i] > LAKE_MIN_FILL;
    if (oceanMask[i]) {
      waterType[i] = WaterType.Ocean; waterMask[i] = 1; surfaceW[i] = seaLevel;
    } else if (standingFill || belowSea) {
      // inland filled basin, or an enclosed sub-sea depression
      waterType[i] = WaterType.Lake; waterMask[i] = 1;
      surfaceW[i] = standingFill ? W[i] : seaLevel;
    } else if (riverMask[i]) {
      waterType[i] = WaterType.River; waterMask[i] = 1; surfaceW[i] = elevation[i];
      const t = drainTo[i];
      if (t >= 0) {
        flowDirX[i] = (t % width) - (i % width);          // already unit (4-neighbour drainTo)
        flowDirY[i] = ((t / width) | 0) - ((i / width) | 0);
      }
      widthArr[i] = Math.min(0.5 * strahler[i], 4);
    }
    // Strahler is only meaningful as a *channel* attribute; zero it off the wet
    // network so consumers read 0 on dry land.
    if (waterType[i] !== WaterType.River) strahler[i] = 0;
  }

  return {
    riverMask, flowField,
    drainTo, surfaceW, waterMask, waterType,
    flowDirX, flowDirY, strahler, width: widthArr,
  };
}
