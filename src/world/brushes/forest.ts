import { placeVegetation } from './vegetation-placer';
import { registerBrush } from '@/world/brushes';
import { canopyOf, undergrowthOf } from '@/flora/biome-flora';
import type { Entity, Region, BrushContext } from '@/core/types';

const BRUSH = 'forest';

const FOREST_PARAMS: import('./vegetation-placer').VegetationParams = {
  brush: BRUSH,
  tileType: 'forest',
  kinds: canopyOf('forest'),
  density: 0.24,
  // `scale` is a per-instance VARIETY multiplier on the kind's metric height
  // (not an absolute size) — a tight ±15% band. We don't rotate vegetation
  // (tilted trees read as wrong); variety comes from this band + full-cell
  // scatter + up to two trees per cell breaking the one-per-tile grid.
  scaleRange: [0.85, 1.15],
  rotationRange: 0,
  offsetRange: [0.5, 0.5],
  maxPerTile: 2,
  clumpScale: 5,
  undergrowth: undergrowthOf('forest'),
};

export function forestBrush(region: Region, seed: number, ctx: BrushContext): Entity[] {
  return placeVegetation(region, seed, ctx, FOREST_PARAMS);
}

registerBrush(BRUSH, forestBrush);
