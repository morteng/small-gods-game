/**
 * WFC Type Declarations
 */

export interface TileDefinition {
  id: string;
  weight: number;
  walkable: boolean;
  height: number;
  color: string;
  segColor: string;
  category: string;
  tree?: boolean;
  treeType?: string;
  flowers?: boolean;
}

export type TileId = string;

export interface TileSetConfig {
  terrainOnly?: boolean;
}

export interface WeightModifiers {
  [tileId: string]: number;
}

export interface Direction {
  dx: number;
  dy: number;
  name: string;
}

export interface ADE20KColors {
  TREE: string;
  GRASS: string;
  WATER: string;
  SEA: string;
  MOUNTAIN: string;
  SAND: string;
  ROAD: string;
  BUILDING: string;
  EARTH: string;
  ROCK: string;
  WALL: string;
  FLOOR: string;
  PLANT: string;
  SWAMP: string;
}

export declare class TileSet {
  terrainOnly: boolean;
  tiles: Record<string, TileDefinition>;
  adjacency: Record<string, string[]>;
  tileIds: string[];

  constructor(terrainOnly?: boolean);

  getAllTileIds(): string[];
  getTile(id: string): TileDefinition | undefined;
  getNeighbors(tileId: string): string[];
  canBeAdjacent(tileA: string, tileB: string): boolean;
  getWeight(tileId: string): number;
  getTilesByCategory(category: string): string[];
  getModifiedWeights(modifiers?: WeightModifiers): Record<string, number>;
}

// Global WFC namespace
declare global {
  interface Window {
    WFC: {
      TileSet: typeof TileSet;
      TILES: Record<string, TileDefinition>;
      ADJACENCY: Record<string, string[]>;
      DIRECTIONS: Direction[];
      TERRAIN_ONLY_IDS: string[];
      TERRAIN_ADJACENCY: Record<string, string[]>;
      ADE20K: ADE20KColors;
    };
  }
}

export {};
