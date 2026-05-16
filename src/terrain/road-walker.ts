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

const WATER_TYPES = new Set(['deep_water', 'shallow_water', 'river', 'ocean', 'water']);

/**
 * A* pathfinder. Returns the lowest-cost 4-connected path from start to goal,
 * or `cells: []` if no path exists under the cost model.
 */
export function walkRoad(
  start: { x: number; y: number },
  goal:  { x: number; y: number },
  tiles: Tile[][],
  fields: TerrainField,
  options: RoadWalkerOptions = {},
): RoadWalkerPath {
  const baseCost    = options.baseCost    ?? DEFAULT_BASE_COST;
  const slopeFactor = options.slopeFactor ?? DEFAULT_SLOPE_FACTOR;
  const waterCost   = options.waterCost   ?? DEFAULT_WATER_COST;
  const bridgeCost  = options.bridgeCost  ?? DEFAULT_BRIDGE_COST;
  const autoBridge  = options.autoBridge  ?? true;

  const height = tiles.length;
  const width  = tiles[0]?.length ?? 0;
  if (height === 0 || width === 0) return { cells: [], cost: 0, bridgeCells: new Set() };

  const idx = (x: number, y: number) => y * width + x;
  const startI = idx(start.x, start.y);
  const goalI  = idx(goal.x,  goal.y);

  const gScore   = new Float32Array(width * height).fill(Infinity);
  const fScore   = new Float32Array(width * height).fill(Infinity);
  const cameFrom = new Int32Array(width * height).fill(-1);
  gScore[startI] = 0;
  fScore[startI] = manhattan(start, goal);

  // Open set: small enough to scan; replace with a heap if perf demands.
  const openSet = new Set<number>([startI]);

  while (openSet.size > 0) {
    let current = -1, bestF = Infinity;
    for (const i of openSet) {
      if (fScore[i] < bestF) { bestF = fScore[i]; current = i; }
    }
    if (current === goalI) break;
    openSet.delete(current);

    const cx = current % width;
    const cy = Math.floor(current / width);
    const cElev = fields.elevation[current];

    const neighbors: Array<[number, number]> = [
      [cx, cy - 1], [cx, cy + 1], [cx - 1, cy], [cx + 1, cy],
    ];
    for (const [nx, ny] of neighbors) {
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const ni = idx(nx, ny);
      const ntile = tiles[ny][nx];
      const isWater = WATER_TYPES.has(ntile.type);
      let stepCost: number;
      if (isWater) {
        if (!autoBridge) {
          // Water is impassable when bridges are disabled (unless the caller
          // explicitly overrode waterCost to a finite value).
          if (options.waterCost === undefined) continue;
          stepCost = waterCost;
        } else {
          stepCost = bridgeCost;
        }
      } else {
        const slope = Math.abs(fields.elevation[ni] - cElev);
        stepCost = baseCost + slopeFactor * slope;
      }
      const tentativeG = gScore[current] + stepCost;
      if (tentativeG < gScore[ni]) {
        cameFrom[ni] = current;
        gScore[ni] = tentativeG;
        fScore[ni] = tentativeG + manhattan({ x: nx, y: ny }, goal);
        openSet.add(ni);
      }
    }
  }

  if (gScore[goalI] === Infinity) {
    return { cells: [], cost: 0, bridgeCells: new Set() };
  }

  const reversePath: number[] = [];
  let i = goalI;
  while (i !== -1) {
    reversePath.push(i);
    i = cameFrom[i];
  }
  reversePath.reverse();

  const cells: Array<{ x: number; y: number }> = [];
  const bridgeCells = new Set<number>();
  for (const pathI of reversePath) {
    const x = pathI % width;
    const y = Math.floor(pathI / width);
    cells.push({ x, y });
    if (WATER_TYPES.has(tiles[y][x].type)) bridgeCells.add(pathI);
  }

  return { cells, cost: gScore[goalI], bridgeCells };
}

function manhattan(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}
