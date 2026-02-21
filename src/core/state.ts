import type { GameMap, Camera, WorldSeed, NpcInstance, NpcSimState, DecorationInstance } from '@/core/types';
import { createCamera } from '@/render/camera';

export interface GameState {
  map: GameMap | null;
  camera: Camera;
  worldSeed: WorldSeed | null;
  npcs: NpcInstance[];
  npcSim: Map<string, NpcSimState>;
  selectedNpcId: string | null;
  visualMap: string[][] | null;
  decorations: DecorationInstance[];
  debug: boolean;
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
    decorations: [],
    debug: false,
  };
}
