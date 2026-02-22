import type { GameMap, Camera, WorldSeed, NpcInstance, NpcSimState, DecorationInstance, TerrainField, BiomeMap } from '@/core/types';
import type { BlobTile } from '@/map/blob-autotiler';
import type { EntityRegistry } from '@/world/entity-registry';
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
  decorations: DecorationInstance[];
  debug: boolean;
  playerPower: number;
  /** Unified entity registry — buildings, trees, rocks, landmarks, etc. */
  entityRegistry: EntityRegistry | null;
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
    decorations: [],
    debug: false,
    playerPower: 3,
    entityRegistry: null,
    terrainFields: null,
    biomeMap: null,
  };
}
