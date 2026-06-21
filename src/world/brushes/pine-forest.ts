import { placeVegetation } from './vegetation-placer';
import { registerBrush } from '@/world/brushes';
import { canopyOf, undergrowthOf } from '@/flora/biome-flora';
import type { Entity, Region, BrushContext } from '@/core/types';

const BRUSH = 'pine_forest';

const PINE_FOREST_PARAMS: import('./vegetation-placer').VegetationParams = {
  brush: BRUSH,
  tileType: 'pine_forest',
  kinds: canopyOf('pine_forest'),
  density: 0.32,
  scaleRange: [0.85, 1.15],   // per-instance variety multiplier on metric height (±15%)
  rotationRange: 0,
  offsetRange: [0.5, 0.5],
  maxPerTile: 2,
  undergrowth: undergrowthOf('pine_forest'),
};

export function pineForestBrush(region: Region, seed: number, ctx: BrushContext): Entity[] {
  return placeVegetation(region, seed, ctx, PINE_FOREST_PARAMS);
}

registerBrush(BRUSH, pineForestBrush);
