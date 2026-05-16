import type { GameMap, Camera, WorldSeed, NpcInstance, NpcSimState, TerrainField, BiomeMap } from '@/core/types';
import type { BlobTile } from '@/map/blob-autotiler';
import type { World } from '@/world/world';
import { createCamera } from '@/render/camera';

export interface GameState {
  map: GameMap | null;
  camera: Camera;
  worldSeed: WorldSeed | null;
  npcs: NpcInstance[];
  npcSim: Map<string, NpcSimState>;
  selectedNpcId: string | null;
  visualMap: string[][] | null;
  blobMap: BlobTile[][] | null;
  debug: boolean;
  paused: boolean;
  showLabels: boolean;
  showPoiMarkers: boolean;
  pinnedNpcId: string | null;
  followNpc: boolean;
  playerPower: number;
  /** Unified world facade — buildings, trees, rocks, landmarks, etc. */
  world: World | null;
  /** Terrain noise fields (elevation, moisture, temperature) */
  terrainFields: TerrainField | null;
  /** Biome classification per tile */
  biomeMap: BiomeMap | null;
}

export function createState(): GameState {
  return {
    map: null,
    camera: createCamera(),
    worldSeed: null,
    npcs: [],
    npcSim: new Map(),
    selectedNpcId: null,
    visualMap: null,
    blobMap: null,
    debug: false,
    paused: false,
    showLabels: true,
    showPoiMarkers: true,
    pinnedNpcId: null,
    followNpc: false,
    playerPower: 3,
    world: null,
    terrainFields: null,
    biomeMap: null,
  };
}
