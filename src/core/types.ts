/** A single tile in the map grid */
export interface Tile {
  type: string;
  x: number;
  y: number;
  walkable: boolean;
  height?: number;
  bridgeDirection?: string;
}

/** Generated map data */
export interface GameMap {
  tiles: Tile[][];
  width: number;
  height: number;
  villages: Village[];
  seed: number;
  success: boolean;
  worldSeed: WorldSeed | null;
  stats: { iterations: number; backtracks: number };
}

/** Village/settlement on the map */
export interface Village {
  x: number;
  y: number;
  name?: string;
  type: string;
}

/** Point of Interest */
export interface POI {
  id: string;
  type: string;
  name?: string;
  description?: string;
  position?: { x: number; y: number };
  region?: { x_min: number; x_max: number; y_min: number; y_max: number };
  size?: 'small' | 'medium' | 'large';
  importance?: 'low' | 'medium' | 'high' | 'critical';
  npcs?: NPC[];
}

/** NPC definition */
export interface NPC {
  name: string;
  role: string;
  description?: string;
  personality?: string;
  knowledge?: string[];
}

/** Connection between POIs */
export interface Connection {
  from: string;
  to: string;
  type: 'road' | 'river' | 'wall';
  style?: 'dirt' | 'stone' | 'bridge';
  waypoints?: { x: number; y: number }[];
  width?: number;
  autoBridge?: boolean;
}

/** World seed -- full world definition */
export interface WorldSeed {
  name: string;
  description?: string;
  size: { width: number; height: number };
  biome: string;
  visualTheme?: string;
  pois: POI[];
  connections: Connection[];
  constraints: string[];
  tileWeights?: Record<string, number>;
  lore?: { history?: string; factions?: string[]; quests?: string[] };
  roadEndpoints?: { direction: string; style?: string }[];
}

/** Camera state for pan/zoom */
export interface Camera {
  x: number;
  y: number;
  zoom: number;
  dragging: boolean;
  lastX: number;
  lastY: number;
}

/** Tile definition from WFC system */
export interface TileDef {
  id: string;
  weight?: number;
  walkable: boolean;
  color: string;
  segColor?: string;
  category: string;
  baseType?: string;
  tree?: boolean;
}

/** Terrain generation options */
export interface TerrainOptions {
  forestDensity: number;
  waterLevel: number;
  villageCount: number;
}

/** NPC role in the world */
export type NpcRole = 'farmer' | 'priest' | 'soldier' | 'merchant' | 'elder' | 'child' | 'noble' | 'beggar';

/** Direction an NPC is facing */
export type Direction = 'up' | 'down' | 'left' | 'right';

/** A live NPC instance on the map */
export interface NpcInstance {
  id: string;
  role: NpcRole;
  seed: number;       // deterministic appearance seed, derived from id
  tileX: number;
  tileY: number;
  direction: Direction;
  frame: number;      // 0 = idle stand, 1–8 = walk cycle
  frameTimer: number; // ms accumulator since last frame advance
}
