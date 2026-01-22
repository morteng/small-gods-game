/**
 * Small Gods - Type Definitions
 */

// Basic geometry types
export interface Point {
  x: number;
  y: number;
}

// Decoration instance on a tile
export interface DecorationInstance {
  id: string;
  offsetX?: number;
  offsetY?: number;
  scale?: number;
  rotation?: number;
  variant?: number;
}

// Tile data
export interface Tile {
  type: string;
  x: number;
  y: number;
  decorations?: DecorationInstance[];
  // Pre-computed render cache
  _ix?: number;
  _iy?: number;
  _seed?: number;
  _heightPx?: number;
  _anchorY?: number;
  _objectExtent?: number;
  _segColor?: string;
}

// Tile type definition (from WFC)
export interface TileType {
  id: string;
  color: string;
  segColor?: string;
  category?: string;
  walkable?: boolean;
  height?: number;
  tree?: boolean;
  treeType?: 'pine' | 'dead' | 'swamp' | 'standard';
  flowers?: boolean;
}

// Game map
export interface GameMap {
  width: number;
  height: number;
  tiles: Tile[][];
  villages: Point[];
  _renderCache?: {
    offsetX: number;
    offsetY: number;
    prepared: boolean;
  };
}

// Camera state
export interface Camera {
  x: number;
  y: number;
  zoom: number;
  dragging: boolean;
  lastX: number;
  lastY: number;
  startX: number;
  startY: number;
}

// NPC data
export interface NPC {
  name: string;
  x: number;
  y: number;
  color?: string;
  sprite?: HTMLCanvasElement | HTMLImageElement;
}

// Control images for AI generation
export interface ControlImages {
  segmentation: HTMLCanvasElement | null;
  edge: HTMLCanvasElement | null;
}

// Game state images
export interface GameImages {
  segment: HTMLCanvasElement | null;
  painted: HTMLCanvasElement | HTMLImageElement | null;
  final: HTMLCanvasElement | HTMLImageElement | null;
}

// Simulation state
export interface SimulationState {
  running: boolean;
  frameId: number | null;
}

// POI (Point of Interest) in world seed
export interface POI {
  id: string;
  type: string;
  name: string;
  position?: Point;
  region?: {
    x_min: number;
    y_min: number;
    x_max?: number;
    y_max?: number;
  };
  size?: 'small' | 'medium' | 'large';
  description?: string;
  visualStyle?: string;
  density?: number;
  npcs?: Array<{ name: string; role: string }>;
}

// Road endpoint in world seed
export interface RoadEndpoint {
  direction: 'north' | 'south' | 'east' | 'west' | 'northeast' | 'northwest' | 'southeast' | 'southwest';
  destination: string;
  description?: string;
  style?: 'dirt' | 'stone';
  position?: Point;
}

// Connection between POIs
export interface Connection {
  from: string;
  to: string;
  type?: 'road' | 'path' | 'river';
  style?: 'dirt' | 'stone';
  description?: string;
}

// World seed configuration
export interface WorldSeed {
  name: string;
  description?: string;
  size?: { width: number; height: number };
  biome?: 'temperate' | 'desert' | 'arctic' | 'tropical' | 'volcanic' | 'swamp';
  visualTheme?: string;
  pois: POI[];
  connections?: Connection[];
  roadEndpoints?: RoadEndpoint[];
  lore?: {
    history?: string;
    quests?: Array<{ name: string; difficulty: string }>;
    rumors?: string[];
  };
}

// Global game state
export interface GameState {
  map: GameMap | null;
  npcs: NPC[];
  layer: 'map' | 'segmentation' | 'edge' | 'painted' | 'final';
  images: GameImages;
  controlImages: ControlImages;
  simulation: SimulationState;
  camera: Camera;
  worldSeed: WorldSeed | null;
  selectedTile?: { x: number; y: number; tile: Tile };
}

// Editor selection types
export interface EditorSelection {
  type: 'poi' | 'roadEndpoint' | 'connection';
  id: string;
  data: POI | RoadEndpoint | Connection;
}

// Editor state
export interface EditorState {
  enabled: boolean;
  mode: 'select' | 'move' | 'add-poi' | 'add-road-endpoint' | 'add-connection';
  selection: EditorSelection | null;
  dragging: boolean;
  dragStart: Point | null;
  hoveredItem: EditorSelection | null;
  showOverlay: boolean;
  showLabels: boolean;
  connectionStart: EditorSelection | null;
}

// Map offset calculation result
export interface MapOffsets {
  tw: number;  // tile width
  th: number;  // tile height
  ox: number;  // x offset
  oy: number;  // y offset
  canvasWidth: number;
  canvasHeight: number;
}

// Cost tracking
export interface Costs {
  paint: number;
  npcs: number;
  zoom: number;
}

// Price constants
export interface Prices {
  PAINT: number;
  NPC: number;
  ZOOM: number;
}
