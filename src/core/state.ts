import type { GameMap, Camera, WorldSeed } from '@/core/types';
import { createCamera } from '@/render/camera';

export interface GameState {
  map: GameMap | null;
  camera: Camera;
  worldSeed: WorldSeed | null;
  debug: boolean;
}

export function createState(): GameState {
  return {
    map: null,
    camera: createCamera(),
    worldSeed: null,
    debug: false,
  };
}
