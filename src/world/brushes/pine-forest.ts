import { defaultEntity } from '@/world/brush-helpers';
import { placeVegetation } from './vegetation-placer';
import { registerBrush } from '@/world/brushes';
import type { Entity, Region, BrushContext } from '@/core/types';

const BRUSH = 'pine_forest';

const PINE_FOREST_PARAMS: import('./vegetation-placer').VegetationParams = {
  brush: BRUSH,
  tileType: 'pine_forest',
  kinds: [
    ['pine_tree', 0.6],
    ['pale_tree', 0.4],
  ],
  density: 0.50,
  scaleRange: [0.85, 1.35],
  rotationRange: 0,
  offsetRange: [0.5, 0.5],
  maxPerTile: 2,
  undergrowth: [
    ['mushroom', 1.0, 0.05],
  ],
};

export function pineForestBrush(region: Region, seed: number, ctx: BrushContext): Entity[] {
  return placeVegetation(region, seed, ctx, PINE_FOREST_PARAMS);
}

registerBrush(BRUSH, pineForestBrush);
