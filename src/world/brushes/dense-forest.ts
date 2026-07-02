import { placeVegetation } from './vegetation-placer';
import { placeGrassCover } from './grassland';
import { registerBrush } from '@/world/brushes';
import { canopyOf, undergrowthOf } from '@/flora/biome-flora';
import type { Entity, Region, BrushContext } from '@/core/types';

const BRUSH = 'dense_forest';

const DENSE_FOREST_PARAMS: import('./vegetation-placer').VegetationParams = {
  brush: BRUSH,
  tileType: 'dense_forest',
  kinds: canopyOf('dense_forest'),
  density: 0.42,
  scaleRange: [0.85, 1.15],   // per-instance variety multiplier on metric height (±15%)
  rotationRange: 0,
  offsetRange: [0.5, 0.5],
  maxPerTile: 2,
  undergrowth: undergrowthOf('dense_forest'),
  openUndergrowth: 0.25,
};

export function denseForestBrush(region: Region, seed: number, ctx: BrushContext): Entity[] {
  return [...placeVegetation(region, seed, ctx, DENSE_FOREST_PARAMS), ...placeGrassCover(region, seed, ctx)];
}

registerBrush(BRUSH, denseForestBrush);
