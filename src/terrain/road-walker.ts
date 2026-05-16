/**
 * Agent walker for inter-POI roads.
 *
 * A* pathfinder over a tile grid using a configurable cost function. Designed
 * to replace Bresenham carving — produces paths that bend around hills and
 * water rather than crossing them blindly.
 *
 * Cost model:
 *   - Base cost per step: 1.0
 *   - Slope penalty:      slopeFactor × |elev[next] - elev[curr]|
 *   - Water cost:         waterCost (very high) unless autoBridge=true
 *                         and we treat the water cell as a bridge step with
 *                         cost = bridgeCost (moderate)
 *
 * Pure function — no DOM access, no mutation of inputs.
 */

import type { Tile, TerrainField } from '@/core/types';

const DEFAULT_BASE_COST = 1.0;
const DEFAULT_SLOPE_FACTOR = 50.0; // 1 unit of elevation diff = 50 base steps
const DEFAULT_WATER_COST = 1000.0;
const DEFAULT_BRIDGE_COST = 5.0;

export interface RoadWalkerOptions {
  /** Base cost per step in flat terrain. Default 1.0. */
  baseCost?: number;
  /** Multiplier on |Δelevation|. Default 50.0. */
  slopeFactor?: number;
  /** Cost to step into a water cell when autoBridge is false. Default 1000 (effectively forbidden). */
  waterCost?: number;
  /** Cost to step into a water cell when autoBridge is true (bridge). Default 5. */
  bridgeCost?: number;
  /** Whether the walker may cross water by placing bridges. Default true. */
  autoBridge?: boolean;
}

export interface RoadWalkerPath {
  /** Cells in order from start to goal, inclusive. Empty if no path found. */
  cells: Array<{ x: number; y: number }>;
  /** Total path cost (sum of step costs). 0 if no path. */
  cost: number;
  /** Which cells are bridges (water tiles the walker stepped into). */
  bridgeCells: Set<number>; // indices into the grid (y * width + x)
}

// Implementation in Task 2.
export function walkRoad(
  _start: { x: number; y: number },
  _goal:  { x: number; y: number },
  _tiles: Tile[][],
  _fields: TerrainField,
  _options: RoadWalkerOptions = {},
): RoadWalkerPath {
  throw new Error('walkRoad not implemented yet — Task 2');
}
