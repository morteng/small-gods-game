/**
 * Agent walker for inter-POI roads.
 *
 * A* pathfinder over a tile grid with a terrain-aware, water-aware cost model.
 * Produces routes that bend around hills, switchback up steep ground, follow river
 * valleys, and cross water only where it is narrow/convenient — the raw material the
 * centerline smoother (road-centerline.ts) then turns into a flowing carved road.
 *
 * Cost model (all pure):
 *   - Base step: `baseCost` (× √2 for a diagonal move).
 *   - Grade: non-linear in the per-step PHYSICAL slope `g = Δmetres / Δmetres-horizontal`
 *     (rise over run — 0.12 = a 12 % grade). The normalised `[0,1]` elevation field is
 *     converted through `reliefM` (the world's metre span for 0→1, style-dependent) and
 *     `METRES_PER_TILE`, so the tolerated steepness no longer silently varies with each
 *     world's relief (the old normalised-unit model made the per-class `maxGrade` mean
 *     84–264 % physical grade at default relief — the over-grade penalty was dead code).
 *     Below `maxGrade` the cost is `slopeFactor·g`; above it a QUADRATIC
 *     `overGradePenalty·(g−maxGrade)²` term makes the walker prefer a longer gentle
 *     detour / switchback over a straight steep climb. Quadratic, not linear, so a
 *     default-relief world's modest hills (a few points over the envelope) barely move
 *     routes while a mountain face (30–100 % over) is prohibitive — grade discomfort
 *     grows superlinearly, exactly the economics real road-builders follow.
 *   - Sub-tile grade: each step's grade is the max of its two HALF-step grades through the
 *     bilinear midpoint of the elevation field — exact for orthogonal steps (the midpoint
 *     is the lattice-edge average) and catches the ridge/valley a diagonal step cuts
 *     across, which a 1-sample-per-tile read under-reported.
 *   - Water: with `autoBridge`, stepping into water costs `bridgeCost` per cell, so a
 *     WIDE river costs proportionally more and the route gravitates to the NARROW
 *     crossing (span-proportional, emergent). Without `autoBridge`, water is forbidden
 *     (unless `waterCost` is overridden to a finite value).
 *   - Bank/valley affinity: a land cell adjacent to water is discounted (`bankAffinity`)
 *     so roads run ALONGSIDE rivers (the natural, gentle corridor).
 *   - Reuse: a cell that is already a road/bridge is discounted (`roadAffinity`) so new
 *     roads bundle onto existing trunks and reuse existing CROSSINGS — convenient
 *     crossings concentrate instead of every road fording its own spot.
 *   - Obstacles: `isObstacle` cells add `obstacleCost` (route around buildings).
 *
 * Deterministic: a binary-heap open set with a stable (f, then insertion-seq) tie-break,
 * so the same inputs always yield the same path.
 */

import type { Tile, TerrainField } from '@/core/types';
import { WATER_TYPES } from '@/core/constants';
import { METRES_PER_TILE } from '@/render/scale-contract';
import { TERRAIN_RELIEF_M } from '@/world/heightfield';

const DEFAULT_BASE_COST = 1.0;
/**
 * Cost per unit of PHYSICAL grade (rise/run). CALIBRATION: the pre-metric model charged
 * `50 · g_norm` with `g_norm = Δelev[0,1]/tiles`; at the default relief (48 m over the
 * 0→1 field, 2 m per tile) `g_phys = g_norm · 48/2 = 24 · g_norm`, so the equivalent
 * physical factor is `50/24 ≈ 2.08`. Kept at that value so default-relief worlds route
 * (near-)identically through the linear term — only the now-honest over-grade penalty
 * changes decisions, and only on genuinely steep ground.
 */
const DEFAULT_SLOPE_FACTOR = 2.08;
const DEFAULT_WATER_COST = 1000.0;
const DEFAULT_BRIDGE_COST = 5.0;
const DEFAULT_OBSTACLE_COST = 200.0;
/** Physical grade (rise/run) beyond which the over-grade penalty bites — the 'road'-class
 *  envelope (12 %); per-class values come from `gradeEnvelope` (road-state.ts). */
const DEFAULT_MAX_GRADE = 0.12;
/** QUADRATIC coefficient on the grade excess: `pen += P·(g−maxGrade)²`. At the 'road'
 *  default (100): 6 points over → 0.36 (noise vs the 1.0 base step — default-relief hills
 *  keep their routes); 20 points over → 4.0 (a real detour); 50 points over → 25
 *  (prohibitive — switchback). */
const DEFAULT_OVER_GRADE_PENALTY = 100.0;
const DEFAULT_BANK_AFFINITY = 0.85; // discount for travelling next to water (follow valleys)
const DEFAULT_ROAD_AFFINITY = 0.6; // discount for reusing existing road/bridge cells

const SQRT2 = Math.SQRT2;

export interface RoadWalkerOptions {
  /** Base cost per orthogonal step in flat terrain. Default 1.0. */
  baseCost?: number;
  /** Multiplier on the per-step PHYSICAL slope (rise/run) below `maxGrade`. Default 2.08
   *  (see the calibration note on `DEFAULT_SLOPE_FACTOR`). */
  slopeFactor?: number;
  /** Physical grade (rise/run) above which the over-grade penalty applies. Default 0.12. */
  maxGrade?: number;
  /** QUADRATIC coefficient on the grade excess (`P·(g−maxGrade)²`) — drives switchbacks
   *  on genuinely steep ground while leaving modest hills routable. Default 100. */
  overGradePenalty?: number;
  /** Metre span of the normalised `[0,1]` elevation field — `TERRAIN_RELIEF_M` by default;
   *  styled worlds pass `worldStyleOf(worldSeed).mountainRelief` so a high-relief world's
   *  roads switchback where a default world's would climb straight. */
  reliefM?: number;
  /** Cost to step into a water cell when autoBridge is false. Default 1000 (forbidden). */
  waterCost?: number;
  /** Cost to step into a water cell when autoBridge is true (bridge). Default 5. */
  bridgeCost?: number;
  /** Whether the walker may cross water by placing bridges. Default true. */
  autoBridge?: boolean;
  /**
   * Whether diagonal (8-connected) moves are allowed. Default FALSE — the rasterized
   * road tiles stay 4-connected (walkability + 4-neighbour flood invariants), and the
   * Catmull-Rom centerline smoother already removes the staircase from the CARVE, so
   * the visual road curves without the tile mask being only corner-connected.
   */
  allowDiagonal?: boolean;
  /** Multiplier (≤1) for a land cell adjacent to water — valley following. Default 0.85. */
  bankAffinity?: number;
  /** Multiplier (≤1) for a cell that is already a road/bridge — trunk + crossing reuse. Default 0.6. */
  roadAffinity?: number;
  /** Cells the road should route AROUND (e.g. building structure cells). Default: none. */
  isObstacle?: (x: number, y: number) => boolean;
  /** Penalty added to a step that lands on an `isObstacle` cell. Default 200. */
  obstacleCost?: number;
  /** Cells that already carry a road/bridge — enables the `roadAffinity` reuse discount. */
  isRoad?: (x: number, y: number) => boolean;
}

export interface RoadWalkerPath {
  /** Cells in order from start to goal, inclusive. Empty if no path found. */
  cells: Array<{ x: number; y: number }>;
  /** Total path cost (sum of step costs). 0 if no path. */
  cost: number;
  /** Which cells are bridges (water tiles the walker stepped into). */
  bridgeCells: Set<number>; // indices into the grid (y * width + x)
}

/** Minimal binary min-heap of grid indices, keyed by f with a stable seq tie-break. */
class MinHeap {
  private idx: number[] = [];
  private f: number[] = [];
  private seq: number[] = [];
  private n = 0;

  push(i: number, f: number, seq: number): void {
    this.idx.push(i);
    this.f.push(f);
    this.seq.push(seq);
    let c = this.n++;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (this.less(c, p)) {
        this.swap(c, p);
        c = p;
      } else break;
    }
  }

  pop(): number {
    const top = this.idx[0];
    this.n--;
    if (this.n > 0) {
      this.idx[0] = this.idx[this.n];
      this.f[0] = this.f[this.n];
      this.seq[0] = this.seq[this.n];
    }
    this.idx.pop();
    this.f.pop();
    this.seq.pop();
    let p = 0;
    while (true) {
      const l = 2 * p + 1;
      const r = l + 1;
      let s = p;
      if (l < this.n && this.less(l, s)) s = l;
      if (r < this.n && this.less(r, s)) s = r;
      if (s === p) break;
      this.swap(s, p);
      p = s;
    }
    return top;
  }

  get size(): number {
    return this.n;
  }

  private less(a: number, b: number): boolean {
    return this.f[a] < this.f[b] || (this.f[a] === this.f[b] && this.seq[a] < this.seq[b]);
  }

  private swap(a: number, b: number): void {
    [this.idx[a], this.idx[b]] = [this.idx[b], this.idx[a]];
    [this.f[a], this.f[b]] = [this.f[b], this.f[a]];
    [this.seq[a], this.seq[b]] = [this.seq[b], this.seq[a]];
  }
}

/** Octile distance — admissible heuristic for 8-connected grids. */
function octile(dx: number, dy: number): number {
  const a = Math.abs(dx);
  const b = Math.abs(dy);
  return Math.max(a, b) + (SQRT2 - 1) * Math.min(a, b);
}

/**
 * A* pathfinder. Returns the lowest-cost path from start to goal under the cost model,
 * or `cells: []` if no path exists.
 */
export function walkRoad(
  start: { x: number; y: number },
  goal: { x: number; y: number },
  tiles: Tile[][],
  fields: TerrainField,
  options: RoadWalkerOptions = {},
): RoadWalkerPath {
  const baseCost = options.baseCost ?? DEFAULT_BASE_COST;
  const slopeFactor = options.slopeFactor ?? DEFAULT_SLOPE_FACTOR;
  const reliefM = options.reliefM ?? TERRAIN_RELIEF_M;
  const maxGrade = options.maxGrade ?? DEFAULT_MAX_GRADE;
  const overGradePenalty = options.overGradePenalty ?? DEFAULT_OVER_GRADE_PENALTY;
  const waterCost = options.waterCost ?? DEFAULT_WATER_COST;
  const bridgeCost = options.bridgeCost ?? DEFAULT_BRIDGE_COST;
  const autoBridge = options.autoBridge ?? true;
  const allowDiagonal = options.allowDiagonal ?? false;
  const bankAffinity = options.bankAffinity ?? DEFAULT_BANK_AFFINITY;
  const roadAffinity = options.roadAffinity ?? DEFAULT_ROAD_AFFINITY;
  const obstacleCost = options.obstacleCost ?? DEFAULT_OBSTACLE_COST;
  const isObstacle = options.isObstacle;
  const isRoad = options.isRoad;

  const height = tiles.length;
  const width = tiles[0]?.length ?? 0;
  if (height === 0 || width === 0) return { cells: [], cost: 0, bridgeCells: new Set() };

  const idx = (x: number, y: number) => y * width + x;
  const startI = idx(start.x, start.y);
  const goalI = idx(goal.x, goal.y);
  const isWaterAt = (x: number, y: number) => WATER_TYPES.has(tiles[y][x].type);

  // Normalised-Δelev → physical grade: Δnorm·reliefM metres of rise over horiz·METRES_PER_TILE
  // metres of run. Precomputed so the inner loop pays one multiply.
  const gradePerNorm = reliefM / METRES_PER_TILE;

  // Bilinear elevation at continuous tile coords (edge-clamped) — the sub-tile midpoint read.
  const elevBilin = (x: number, y: number): number => {
    const x0 = Math.max(0, Math.min(width - 1, Math.floor(x)));
    const y0 = Math.max(0, Math.min(height - 1, Math.floor(y)));
    const x1 = Math.min(width - 1, x0 + 1);
    const y1 = Math.min(height - 1, y0 + 1);
    const fx = Math.max(0, Math.min(1, x - x0));
    const fy = Math.max(0, Math.min(1, y - y0));
    const e = fields.elevation;
    const a = e[y0 * width + x0], b = e[y0 * width + x1];
    const c = e[y1 * width + x0], d = e[y1 * width + x1];
    return a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy;
  };

  // Bank mask: land cell with a water 4-neighbour. Precomputed once → O(1) per step.
  const bank = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (isWaterAt(x, y)) continue;
      if (
        (x > 0 && isWaterAt(x - 1, y)) ||
        (x < width - 1 && isWaterAt(x + 1, y)) ||
        (y > 0 && isWaterAt(x, y - 1)) ||
        (y < height - 1 && isWaterAt(x, y + 1))
      ) {
        bank[idx(x, y)] = 1;
      }
    }
  }

  const gScore = new Float32Array(width * height).fill(Infinity);
  const cameFrom = new Int32Array(width * height).fill(-1);
  const closed = new Uint8Array(width * height);
  // Heuristic stays admissible under the discounts: scale by the cheapest per-unit cost.
  const hMult = baseCost * Math.min(1, bankAffinity, roadAffinity);
  const heur = (x: number, y: number) => octile(x - goal.x, y - goal.y) * hMult;

  gScore[startI] = 0;
  const open = new MinHeap();
  let seq = 0;
  open.push(startI, heur(start.x, start.y), seq++);

  const NEIGHBORS: Array<[number, number, boolean]> = [
    [0, -1, false], [0, 1, false], [-1, 0, false], [1, 0, false],
    [-1, -1, true], [1, -1, true], [-1, 1, true], [1, 1, true],
  ];

  while (open.size > 0) {
    const current = open.pop();
    if (current === goalI) break;
    if (closed[current]) continue;
    closed[current] = 1;

    const cx = current % width;
    const cy = (current / width) | 0;
    const cElev = fields.elevation[current];

    for (const [dx, dy, diag] of NEIGHBORS) {
      if (diag && !allowDiagonal) continue;
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const ni = idx(nx, ny);
      if (closed[ni]) continue;
      const horiz = diag ? SQRT2 : 1;
      const nWater = isWaterAt(nx, ny);

      let stepCost: number;
      if (nWater) {
        // Don't cut a diagonal across a water corner (both shared orthogonals water).
        if (diag && isWaterAt(cx, ny) && isWaterAt(nx, cy)) continue;
        if (!autoBridge) {
          if (options.waterCost === undefined) continue; // impassable
          stepCost = waterCost * horiz;
        } else {
          stepCost = bridgeCost * horiz; // span emerges from consecutive water cells
        }
        if (isRoad?.(nx, ny)) stepCost *= roadAffinity; // reuse an existing crossing
      } else {
        // PHYSICAL step grade at half-tile resolution: the worse of the two half-steps
        // through the bilinear midpoint. For an orthogonal step the midpoint is the exact
        // lattice-edge average, so this equals the full-step grade; a diagonal step stops
        // under-reporting the ridge/valley it cuts across.
        const eMid = elevBilin((cx + nx) / 2, (cy + ny) / 2);
        const eN = fields.elevation[ni];
        const dNorm = Math.max(Math.abs(eMid - cElev), Math.abs(eN - eMid)) / (horiz / 2);
        const g = dNorm * gradePerNorm;
        let pen = slopeFactor * g;
        if (g > maxGrade) { const ex = g - maxGrade; pen += overGradePenalty * ex * ex; }
        stepCost = horiz * baseCost + pen;
        if (bank[ni]) stepCost *= bankAffinity; // follow the river valley
        if (isRoad?.(nx, ny)) stepCost *= roadAffinity; // bundle onto the trunk
        if (isObstacle?.(nx, ny)) stepCost += obstacleCost;
      }

      const tentativeG = gScore[current] + stepCost;
      if (tentativeG < gScore[ni]) {
        cameFrom[ni] = current;
        gScore[ni] = tentativeG;
        open.push(ni, tentativeG + heur(nx, ny), seq++);
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
    const y = (pathI / width) | 0;
    cells.push({ x, y });
    if (WATER_TYPES.has(tiles[y][x].type)) bridgeCells.add(pathI);
  }

  return { cells, cost: gScore[goalI], bridgeCells };
}
