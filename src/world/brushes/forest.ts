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
  // `scale` is a per-instance VARIETY multiplier on the kind's metric height
  // (not an absolute size) — a tight ±15% band. We don't rotate vegetation
  // (tilted trees read as wrong); variety comes from this band + full-cell
  // scatter + up to two trees per cell breaking the one-per-tile grid.
  scaleRange: [0.85, 1.15],
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
