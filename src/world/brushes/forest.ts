import { noise } from '@/core/noise';
import { defaultEntity } from '@/world/brush-helpers';
import { placeVegetation } from './vegetation-placer';
import { registerBrush } from '@/world/brushes';
import type { Entity, Region, BrushContext } from '@/core/types';

const BRUSH = 'forest';

const FOREST_PARAMS: import('./vegetation-placer').VegetationParams = {
  brush: BRUSH,
  tileType: 'forest',
  kinds: [
    ['oak_tree', 0.5],
    ['orange_tree', 0.25],
    ['pale_tree', 0.25],
  ],
  density: 0.35,
  // Wide scale range is the main source of visual variety (we don't rotate
  // vegetation — tilted trees read as wrong). Full-cell scatter + up to two
  // trees per cell break the one-per-tile grid into an organic stand.
  scaleRange: [0.6, 1.5],
  rotationRange: 0,
  offsetRange: [0.5, 0.5],
  maxPerTile: 2,
  clumpScale: 5,
  undergrowth: [
    ['shrub', 0.6, 0.05],
    ['fern', 0.4, 0.05],
  ],
};

export function forestBrush(region: Region, seed: number, ctx: BrushContext): Entity[] {
  return placeVegetation(region, seed, ctx, FOREST_PARAMS);
}

registerBrush(BRUSH, forestBrush);
