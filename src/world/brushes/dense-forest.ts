import { defaultEntity } from '@/world/brush-helpers';
import { placeVegetation } from './vegetation-placer';
import { registerBrush } from '@/world/brushes';
import type { Entity, Region, BrushContext } from '@/core/types';

const BRUSH = 'dense_forest';

const DENSE_FOREST_PARAMS: import('./vegetation-placer').VegetationParams = {
  brush: BRUSH,
  tileType: 'dense_forest',
  kinds: [
    ['oak_tree', 0.6],
    ['brown_tree', 0.4],
  ],
  density: 0.70,
  scaleRange: [0.85, 1.15],   // per-instance variety multiplier on metric height (±15%)
  rotationRange: 0,
  offsetRange: [0.5, 0.5],
  maxPerTile: 3,
  undergrowth: [
    ['shrub', 0.5, 0.10],
    ['fern', 0.5, 0.10],
  ],
};

export function denseForestBrush(region: Region, seed: number, ctx: BrushContext): Entity[] {
  return placeVegetation(region, seed, ctx, DENSE_FOREST_PARAMS);
}

registerBrush(BRUSH, denseForestBrush);
