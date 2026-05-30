import { defaultEntity } from '@/world/brush-helpers';
import { placeVegetation } from './vegetation-placer';
import { registerBrush } from '@/world/brushes';
import type { Entity, Region, BrushContext } from '@/core/types';

const BRUSH = 'scrubland';

const SCRUBLAND_PARAMS: import('./vegetation-placer').VegetationParams = {
  brush: BRUSH,
  tileType: 'scrubland',
  kinds: [
    ['shrub', 0.5],
    ['cactus', 0.25],
    ['grass_tuft', 0.25],
  ],
  density: 0.20,
  scaleRange: [0.7, 1.1],
  rotationRange: 20,
  offsetRange: [0.35, 0.35],
  undergrowth: [
    ['boulder', 1.0, 0.02],
  ],
};

export function scrublandBrush(region: Region, seed: number, ctx: BrushContext): Entity[] {
  return placeVegetation(region, seed, ctx, SCRUBLAND_PARAMS);
}

registerBrush(BRUSH, scrublandBrush);
