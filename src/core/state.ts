import type { GameMap, Camera, WorldSeed, NpcInstance, DecorationInstance } from '@/core/types';
import { createCamera } from '@/render/camera';

export interface GameState {
  map: GameMap | null;
  camera: Camera;
  worldSeed: WorldSeed | null;
  npcs: NpcInstance[];
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
    visualMap: null,
    decorations: [],
    debug: false,
  };
}
