import type { BlobTile } from '@/map/blob-autotiler';

/** A single tile in the map grid */
export interface Tile {
  type: string;
  x: number;
  y: number;
  walkable: boolean;
  height?: number;
  bridgeDirection?: string;
}

/** A placed building on the map */
export interface BuildingInstance {
  id: string;
  templateId: string;
  tileX: number;         // top-left corner of footprint
  tileY: number;
  poiId?: string;        // owning POI
  state: 'intact' | 'damaged' | 'ruined' | 'construction';
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
  buildings: BuildingInstance[];
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

/** A decoration sprite placed on a tile (trees, rocks, furniture, etc.) */
export interface DecorationInstance {
  id: string;
  category: 'tree' | 'flora' | 'furniture' | 'structure' | 'rock';
  variant: string;       // 'green' | 'orange' | 'dead' | 'pale' | 'brown' for trees
  tileX: number;
  tileY: number;
  offsetX: number;       // sub-tile jitter [-0.15, 0.15] in tile units
  offsetY: number;
  spriteCol: number;     // col index in the spritesheet grid
  spriteRow: number;     // row index in the spritesheet grid
}

/** Context passed to renderMap */
export interface RenderContext {
  map: GameMap;
  camera: Camera;
  canvasWidth: number;
  canvasHeight: number;
  npcs: NpcInstance[];
  npcSheets: Map<string, HTMLCanvasElement>;
  visualMap: string[][] | null;
  blobMap: BlobTile[][] | null;
  tileAtlas: HTMLImageElement | null;
  terrainSheets: Map<string, HTMLImageElement>;
  buildingSprites: Map<string, HTMLImageElement>;
  decorations: DecorationInstance[];
  treeSheets: Map<string, HTMLImageElement>;
}

/** A live NPC instance on the map */
export interface NpcInstance {
  id: string;
  name: string;
  role: NpcRole;
  seed: number;       // deterministic appearance seed, derived from id
  tileX: number;
  tileY: number;
  direction: Direction;
  frame: number;      // 0 = idle stand, 1–8 = walk cycle
  frameTimer: number; // ms accumulator since last frame advance
  homeBuildingId?: string;
  homePoiId?: string;
}

export interface NpcPersonality {
  assertiveness: number;  // 0–1: how strongly they share beliefs (Phase 8+ propagation)
  skepticism:    number;  // 0–1: resistance to faith change
  piety:         number;  // 0–1: baseline religious tendency
  sociability:   number;  // 0–1: social pressure weight (reserved for propagation)
}

export interface SpiritBelief {
  faith:         number;  // 0–1: raw belief strength
  understanding: number;  // 0–1: depth of comprehension (quality multiplier)
  devotion:      number;  // 0–1: behavioral commitment
}

export interface NpcNeeds {
  safety:     number;  // 0–1 (higher = more satisfied)
  prosperity: number;
  community:  number;
  meaning:    number;
}

// ─── Terrain system (Phase I) ─────────────────────────────────────────────────

export interface TerrainConfig {
  seed: number;
  width: number;
  height: number;
  elevationScale?: number;   // default 0.02
  moistureScale?: number;    // default 0.03
  seaLevel?: number;         // default 0.35
  poleFalloff?: boolean;     // temperature drops at poles
  continentWarp?: number;    // domain warp strength (0 = off)
}

export interface TerrainField {
  elevation: Float32Array;   // [width * height], range [0, 1]
  moisture: Float32Array;
  temperature: Float32Array;
}

export interface BiomeMap {
  biomes: string[];          // Biome enum values, length = width * height
  width: number;
  height: number;
}

// ─── Entity system (Phase II) ─────────────────────────────────────────────────

export type Era = 'primordial' | 'ancient' | 'classical' | 'medieval' | 'current';
export type ReligiousSignificance = 'sacred' | 'profane' | 'neutral' | 'contested';
export type EntityCategory =
  | 'building' | 'tree' | 'rock' | 'flora' | 'furniture'
  | 'resource' | 'landmark' | 'npc' | 'item';

export interface WorldEntity {
  id: string;
  category: EntityCategory;
  type: string;                    // 'cottage', 'oak_tree', 'shrine', etc.
  templateId?: string;             // links to BuildingTemplate etc.
  tileX: number;
  tileY: number;
  footprint?: { w: number; h: number };
  offsetX?: number;                // sub-tile jitter
  offsetY?: number;
  poiId?: string;
  ownerId?: string;
  era: Era;
  religiousSignificance: ReligiousSignificance;
  name?: string;
  lore?: string;
  state: string;                   // 'intact' | 'ruined' | 'growing' | etc.
  metadata: Record<string, unknown>;
  spriteCol?: number;
  spriteRow?: number;
  variant?: string;
  sortYOffset?: number;
}

export interface NpcSimState {
  npcId:           string;
  name:            string;
  role:            NpcRole;
  personality:     NpcPersonality;
  beliefs:         Record<string, SpiritBelief>;  // key = spirit id, e.g. 'player'
  needs:           NpcNeeds;
  mood:            number;  // 0–1, derived from needs each tick
  recentEvents:    string[];   // ring buffer, max 5
  whisperCooldown: number;     // integer seconds remaining (ticked per sim tick)
  homeBuildingId?: string;
  homePoiId?:      string;
}
