/**
 * Autotiler - Converts semantic tile types to Kenney visual variants
 *
 * Kenney Isometric Tileset Coordinate System:
 * ==========================================
 *
 * Our grid: x increases right, y increases down (standard 2D array)
 *
 * Isometric projection formula: isoX = (x - y) * w/2, isoY = (x + y) * h/2
 *   - Grid origin (0,0) is at the BACK (top) of the diamond
 *   - Increasing x moves toward FRONT-RIGHT on screen
 *   - Increasing y moves toward FRONT-LEFT on screen
 *
 * Kenney tile naming convention (based on visual screen direction):
 *   - road_ns = road running vertically on screen (top-left to bottom-right diagonal in grid)
 *   - road_ew = road running horizontally on screen (top-right to bottom-left diagonal in grid)
 *
 * Grid-to-Visual Mapping (90 deg CW rotation):
 * ==========================================
 *   Grid N (y-1) -> Visual E (connects toward top-right on screen)
 *   Grid E (x+1) -> Visual S (connects toward bottom-right on screen)
 *   Grid S (y+1) -> Visual W (connects toward bottom-left on screen)
 *   Grid W (x-1) -> Visual N (connects toward top-left on screen)
 */

import { TILES } from '@/wfc';
import type { Tile } from '@/core/types';

/** Cardinal neighbor types (grid directions) */
export interface Neighbors {
  n: string | null;
  e: string | null;
  s: string | null;
  w: string | null;
}

/** Diagonal neighbor types */
export interface DiagonalNeighbors {
  ne: string | null;
  se: string | null;
  sw: string | null;
  nw: string | null;
}

/** A map with tiles and dimensions */
interface TileMap {
  tiles: Tile[][];
  width: number;
  height: number;
}

/** Variant lookup table indexed by direction mask */
type VariantTable = Record<number, string>;

export const Autotiler = {

  // ==========================================================================
  // COORDINATE SYSTEM TRANSFORMATIONS
  // ==========================================================================

  /**
   * Convert grid direction mask to Kenney visual direction mask
   * Applies 90 deg CW rotation to align grid neighbors with Kenney tile edges
   * Bits: N=0001, E=0010, S=0100, W=1000
   */
  gridMaskToVisual(gridMask: number): number {
    // 90 deg CW rotation: Grid N->Visual E, Grid E->Visual S, Grid S->Visual W, Grid W->Visual N
    let visualMask = 0;
    if (gridMask & 0b0001) visualMask |= 0b0010; // Grid N -> Visual E
    if (gridMask & 0b0010) visualMask |= 0b0100; // Grid E -> Visual S
    if (gridMask & 0b0100) visualMask |= 0b1000; // Grid S -> Visual W
    if (gridMask & 0b1000) visualMask |= 0b0001; // Grid W -> Visual N
    return visualMask;
  },

  // ==========================================================================
  // TILE TYPE PREDICATES
  // ==========================================================================

  isWater(type: string | null): boolean {
    return type === 'water' || type === 'river';
  },

  isLand(type: string | null): boolean {
    if (!type) return false;
    const tile = TILES[type];
    return tile != null && tile.category !== 'water';
  },

  isLowerTerrain(type: string | null): boolean {
    return ['grass', 'dirt', 'water', 'river', 'forest', 'beach'].includes(type as string);
  },

  isRoad(type: string | null): boolean {
    return type === 'road' || type === 'dirt_road' || type === 'stone_road'
      || (type != null && (type.startsWith('road_') || type.startsWith('dirt_road_') || type.startsWith('stone_road_')));
  },

  isBeach(type: string | null): boolean {
    return type === 'beach' || (type != null && type.startsWith('beach_'));
  },

  isLot(type: string | null): boolean {
    return type === 'lot' || (type != null && type.startsWith('lot_'));
  },

  // ==========================================================================
  // VARIANT LOOKUP TABLES (indexed by VISUAL direction mask)
  // ==========================================================================

  /**
   * Road variants - Mask bits: N=0001, E=0010, S=0100, W=1000 (visual NESW)
   */
  ROAD_VARIANTS: {
    0b0000: 'road_ns',      // Isolated
    0b0001: 'road_end_n',   // N only
    0b0010: 'road_end_e',   // E only
    0b0011: 'road_ne',      // N + E corner
    0b0100: 'road_end_s',   // S only
    0b0101: 'road_ns',      // N + S straight
    0b0110: 'road_se',      // E + S corner
    0b0111: 'road_t_nes',   // T: N + E + S (missing W)
    0b1000: 'road_end_w',   // W only
    0b1001: 'road_nw',      // N + W corner
    0b1010: 'road_ew',      // E + W straight
    0b1011: 'road_t_new',   // T: N + E + W (missing S)
    0b1100: 'road_sw',      // S + W corner
    0b1101: 'road_t_nsw',   // T: N + S + W (missing E)
    0b1110: 'road_t_esw',   // T: E + S + W (missing N)
    0b1111: 'road_cross',   // All 4: crossroad
  } as VariantTable,

  /**
   * River variants
   */
  RIVER_VARIANTS: {
    0b0000: 'river_ns',
    0b0001: 'river_ns',
    0b0010: 'river_ew',
    0b0011: 'river_ne',
    0b0100: 'river_ns',
    0b0101: 'river_ns',
    0b0110: 'river_se',
    0b0111: 'river_ns',
    0b1000: 'river_ew',
    0b1001: 'river_nw',
    0b1010: 'river_ew',
    0b1011: 'river_ew',
    0b1100: 'river_sw',
    0b1101: 'river_ns',
    0b1110: 'river_ew',
    0b1111: 'river_ns',
  } as VariantTable,

  /**
   * Shore variants (where water IS, using CCW mapping)
   */
  SHORE_VARIANTS: {
    0b0001: 'shore_n',
    0b0010: 'shore_e',
    0b0011: 'shore_corner_ne',
    0b0100: 'shore_s',
    0b0110: 'shore_corner_se',
    0b1000: 'shore_w',
    0b1001: 'shore_corner_nw',
    0b1100: 'shore_corner_sw',
  } as VariantTable,

  /**
   * Water inner corners (for concave water shapes - land protruding into water)
   * These are water tiles with land in a corner
   */
  WATER_INNER_VARIANTS: {
    0b0011: 'water_inner_ne',
    0b0110: 'water_inner_se',
    0b1001: 'water_inner_nw',
    0b1100: 'water_inner_sw',
  } as VariantTable,

  /**
   * Beach variants (sand-to-water, using CCW mapping like shores)
   */
  BEACH_VARIANTS: {
    0b0001: 'beach_n',
    0b0010: 'beach_e',
    0b0011: 'beach_corner_ne',
    0b0100: 'beach_s',
    0b0110: 'beach_corner_se',
    0b1000: 'beach_w',
    0b1001: 'beach_corner_nw',
    0b1100: 'beach_corner_sw',
    // Two-sided beaches
    0b0101: 'beach_n',  // Opposite sides - use single
    0b1010: 'beach_e',
  } as VariantTable,

  /**
   * Hill variants (where lower terrain IS, using CW mapping)
   */
  HILL_VARIANTS: {
    0b0001: 'hill_n',
    0b0010: 'hill_e',
    0b0011: 'hill_ne',
    0b0100: 'hill_s',
    0b0110: 'hill_se',
    0b1000: 'hill_w',
    0b1001: 'hill_nw',
    0b1100: 'hill_sw',
  } as VariantTable,

  /**
   * Lot variants (building foundation edges)
   */
  LOT_VARIANTS: {
    0b0001: 'lot_n',
    0b0010: 'lot_e',
    0b0011: 'lot_ne',
    0b0100: 'lot_s',
    0b0110: 'lot_se',
    0b1000: 'lot_w',
    0b1001: 'lot_nw',
    0b1100: 'lot_sw',
  } as VariantTable,

  /**
   * Bridge variants (road crossing water)
   */
  BRIDGE_VARIANTS: {
    0b0101: 'bridge_ns',  // N + S (visual)
    0b1010: 'bridge_ew',  // E + W (visual)
  } as VariantTable,

  /**
   * Direction suffixes indexed by VISUAL direction mask — shared across all road types.
   * Used by getRoadVariantForType() to produce type-specific variant strings.
   */
  DIRECTION_SUFFIXES: {
    0b0000: 'ns',       // Isolated (default to straight)
    0b0001: 'end_n',
    0b0010: 'end_e',
    0b0011: 'ne',
    0b0100: 'end_s',
    0b0101: 'ns',       // N+S straight
    0b0110: 'se',
    0b0111: 't_nes',
    0b1000: 'end_w',
    0b1001: 'nw',
    0b1010: 'ew',       // E+W straight
    0b1011: 't_new',
    0b1100: 'sw',
    0b1101: 't_nsw',
    0b1110: 't_esw',
    0b1111: 'cross',
  } as VariantTable,

  // ==========================================================================
  // CORE AUTOTILING FUNCTIONS
  // ==========================================================================

  /**
   * Get visual variant for a tile based on its type and neighbors
   */
  getVisualVariant(tileType: string, neighbors: Neighbors): string {
    // Road tiles — all road types handled polymorphically
    if (tileType === 'road' || tileType === 'dirt_road' || tileType === 'stone_road') {
      // Check if this is a bridge (road with water on perpendicular sides)
      const bridgeVariant = this.getBridgeVariant(neighbors);
      if (bridgeVariant) return bridgeVariant;
      return this.getRoadVariantForType(tileType, neighbors);
    }

    // River tiles
    if (tileType === 'river') {
      return this.getRiverVariant(neighbors);
    }

    // Water tiles - check for inner corners
    if (tileType === 'water') {
      const innerVariant = this.getWaterInnerVariant(neighbors);
      if (innerVariant) return innerVariant;
      return 'water';
    }

    // Hill tiles
    if (tileType === 'hill') {
      return this.getHillVariant(neighbors);
    }

    // Beach tiles
    if (tileType === 'beach') {
      return this.getBeachVariant(neighbors);
    }

    // Lot tiles (building foundations)
    if (tileType === 'lot') {
      return this.getLotVariant(neighbors);
    }

    // Land tiles adjacent to water become shores
    if (this.isLand(tileType) && tileType !== 'beach') {
      const shoreVariant = this.getShoreVariant(neighbors);
      if (shoreVariant) return shoreVariant;
    }

    // Forest renders as grass base (trees added as decorations)
    if (tileType === 'forest') {
      return 'grass';
    }

    return tileType;
  },

  /**
   * Build a grid direction mask from neighbors matching a predicate
   */
  buildGridMask(neighbors: Neighbors, predicate: (type: string | null) => boolean): number {
    let mask = 0;
    if (predicate(neighbors.n)) mask |= 0b0001; // Grid N
    if (predicate(neighbors.e)) mask |= 0b0010; // Grid E
    if (predicate(neighbors.s)) mask |= 0b0100; // Grid S
    if (predicate(neighbors.w)) mask |= 0b1000; // Grid W
    return mask;
  },

  // ==========================================================================
  // VARIANT GETTERS
  // ==========================================================================

  getRoadVariant(neighbors: Neighbors): string {
    const gridMask = this.buildGridMask(neighbors, t => this.isRoad(t));
    const visualMask = this.gridMaskToVisual(gridMask);
    return this.ROAD_VARIANTS[visualMask] || 'road_ns';
  },

  /** Get road variant string for a specific road type (road, dirt_road, stone_road) */
  getRoadVariantForType(roadType: string, neighbors: Neighbors): string {
    const prefix = roadType === 'dirt_road' ? 'dirt_road'
                 : roadType === 'stone_road' ? 'stone_road'
                 : 'road';
    const gridMask = this.buildGridMask(neighbors, t => this.isRoad(t));
    const visualMask = this.gridMaskToVisual(gridMask);
    const suffix = this.DIRECTION_SUFFIXES[visualMask] || 'ns';
    return `${prefix}_${suffix}`;
  },

  getBridgeVariant(neighbors: Neighbors): string | null {
    // Bridge when road has water on perpendicular sides
    const roadMask = this.buildGridMask(neighbors, t => this.isRoad(t));
    const waterMask = this.buildGridMask(neighbors, t => this.isWater(t));

    // NS bridge: road connects N-S, water on E-W
    if ((roadMask & 0b0101) === 0b0101 && (waterMask & 0b1010) === 0b1010) {
      return 'bridge_ns';
    }
    // EW bridge: road connects E-W, water on N-S
    if ((roadMask & 0b1010) === 0b1010 && (waterMask & 0b0101) === 0b0101) {
      return 'bridge_ew';
    }
    return null;
  },

  getRiverVariant(neighbors: Neighbors): string {
    const gridMask = this.buildGridMask(neighbors, t => this.isWater(t));
    const visualMask = this.gridMaskToVisual(gridMask);
    return this.RIVER_VARIANTS[visualMask] || 'river_ns';
  },

  getShoreVariant(neighbors: Neighbors): string | null {
    const gridMask = this.buildGridMask(neighbors, t => t === 'water');
    if (gridMask === 0) return null;

    // Only handle 1 or 2 adjacent water tiles (edges and corners)
    const waterCount = this.countBits(gridMask);
    if (waterCount > 2) return null;

    // Shore tiles are named by GRID direction (where water is), not visual direction
    // So use gridMask directly without rotation
    return this.SHORE_VARIANTS[gridMask] || null;
  },

  getWaterInnerVariant(neighbors: Neighbors): string | null {
    // Inner corners occur when land protrudes diagonally into water
    // Check for land in corner positions (diagonal neighbors would be ideal,
    // but we approximate with adjacent land on two perpendicular sides)
    const landMask = this.buildGridMask(neighbors, t => this.isLand(t) && t !== 'beach');

    // Need exactly 2 adjacent lands in a corner configuration
    if (this.countBits(landMask) !== 2) return null;

    // Water inner tiles are named by GRID direction, use mask directly
    return this.WATER_INNER_VARIANTS[landMask] || null;
  },

  getBeachVariant(neighbors: Neighbors): string {
    const waterMask = this.buildGridMask(neighbors, t => t === 'water');
    if (waterMask === 0) return 'beach';

    // Beach tiles are named by GRID direction (where water is), use mask directly
    return this.BEACH_VARIANTS[waterMask] || 'beach';
  },

  getHillVariant(neighbors: Neighbors): string {
    const gridMask = this.buildGridMask(neighbors, t => this.isLowerTerrain(t));

    // If surrounded by hills or by lower terrain on all sides, use plain grass
    if (gridMask === 0 || gridMask === 0b1111) {
      return 'grass';
    }

    // Only handle 1-2 adjacent lower terrain (single edges and corners)
    const count = this.countBits(gridMask);
    if (count > 2) return 'grass';

    // Hill tiles are named by GRID direction (where lower terrain is), use mask directly
    return this.HILL_VARIANTS[gridMask] || 'grass';
  },

  getLotVariant(neighbors: Neighbors): string {
    // Lots show edges where they meet non-lot terrain
    const nonLotMask = this.buildGridMask(neighbors, t => !this.isLot(t));

    if (nonLotMask === 0 || nonLotMask === 0b1111) {
      return 'lot';  // Interior or isolated
    }

    const count = this.countBits(nonLotMask);
    if (count > 2) return 'lot';

    // Lot tiles are named by GRID direction, use mask directly
    return this.LOT_VARIANTS[nonLotMask] || 'lot';
  },

  // ==========================================================================
  // UTILITIES
  // ==========================================================================

  countBits(n: number): number {
    let count = 0;
    let v = n;
    while (v) {
      count += v & 1;
      v >>= 1;
    }
    return count;
  },

  /**
   * Get neighbors from a tile map
   * Returns grid-direction neighbors (n=y-1, e=x+1, s=y+1, w=x-1)
   */
  getNeighbors(tiles: Tile[][], x: number, y: number, width: number, height: number): Neighbors {
    return {
      n: y > 0 ? tiles[y - 1][x]?.type : null,
      e: x < width - 1 ? tiles[y][x + 1]?.type : null,
      s: y < height - 1 ? tiles[y + 1][x]?.type : null,
      w: x > 0 ? tiles[y][x - 1]?.type : null,
    };
  },

  /**
   * Get diagonal neighbors (for advanced autotiling)
   */
  getDiagonalNeighbors(tiles: Tile[][], x: number, y: number, width: number, height: number): DiagonalNeighbors {
    return {
      ne: (y > 0 && x < width - 1) ? tiles[y - 1][x + 1]?.type : null,
      se: (y < height - 1 && x < width - 1) ? tiles[y + 1][x + 1]?.type : null,
      sw: (y < height - 1 && x > 0) ? tiles[y + 1][x - 1]?.type : null,
      nw: (y > 0 && x > 0) ? tiles[y - 1][x - 1]?.type : null,
    };
  },

  /**
   * Process entire map and return visual variant names for each tile
   */
  computeVisualMap(map: TileMap): string[][] | null {
    if (!map || !map.tiles) return null;

    const { tiles, width, height } = map;
    const visualMap: string[][] = [];

    for (let y = 0; y < height; y++) {
      const row: string[] = [];
      for (let x = 0; x < width; x++) {
        const tile = tiles[y][x];
        const neighbors = this.getNeighbors(tiles, x, y, width, height);
        const variant = this.getVisualVariant(tile.type, neighbors);
        row.push(variant);
      }
      visualMap.push(row);
    }

    return visualMap;
  }
};
