import type { BlobTile } from '@/map/blob-autotiler';
import type { World } from '@/world/world';

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
  treeSheets: Map<string, HTMLImageElement>;
  world: World;
  showLabels?: boolean;
  showPoiMarkers?: boolean;
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
  // Random-walk movement scaffolding (placeholder until proper schedules land).
  // moveCooldown counts down in ms; on reach 0 the NPC picks a new step.
  moveCooldown?: number;
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

/**
 * Output of the drainage-basin hydrology pass.
 * `riverMask[i] === 1` means cell i should become a river tile.
 * `flowField[i]` is the accumulated flow count (number of paths that visited cell i).
 */
export interface HydrologyResult {
  riverMask: Uint8Array;   // [width * height], 0 or 1
  flowField: Float32Array; // [width * height], ≥ 0
}

// ─── Entity system (Phase II) — legacy type aliases ──────────────────────────
// These kept for code that still imports them. WorldEntity is now an alias for
// Entity; the old fields (category, type, tileX, tileY, etc.) are gone — they
// live in Entity.properties and Entity.x/y respectively.

export type Era = 'primordial' | 'ancient' | 'classical' | 'medieval' | 'current';
export type ReligiousSignificance = 'sacred' | 'profane' | 'neutral' | 'contested';

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

// ─── Entity system v2 (Spec A) ────────────────────────────────────────────────

export type EntityId = string;

/** Spec-A Entity: every visible world object collapses into this shape. */
export interface Entity {
  id: EntityId;
  kind: string;
  x: number;                                  // tile coords, sub-tile allowed
  y: number;
  properties?: Record<string, unknown>;
  tags?: ReadonlyArray<string>;
}

/** Backwards-compat alias — all consumers should migrate to Entity. */
export type WorldEntity = Entity;

export interface Region {
  x: number;       // top-left tile x
  y: number;       // top-left tile y
  w: number;       // width in tiles
  h: number;
}

export interface SpriteRef {
  atlas?: string;                            // atlas key e.g. 'lpc-terrain'
  region?: { sx: number; sy: number; sw: number; sh: number };
  fallbackColor?: string;                    // e.g. '#7ab06e'
  fallbackShape?: 'circle' | 'square' | 'triangle';
}

/** Read-only view of the World, passed to brushes. */
export interface WorldReadOnly {
  query(opts: {
    region?: Region;
    kind?: string;
    tag?: string;
    limit?: number;
  }): Entity[];
  tileAt(x: number, y: number): Tile | undefined;
}

export interface BrushContext {
  world: WorldReadOnly;
  tiles: GameMap;
}
