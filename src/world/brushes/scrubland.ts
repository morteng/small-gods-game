import { placeVegetation } from './vegetation-placer';
import { registerBrush } from '@/world/brushes';
import { canopyOf, undergrowthOf } from '@/flora/biome-flora';
import type { Entity, Region, BrushContext } from '@/core/types';

const BRUSH = 'scrubland';

const SCRUBLAND_PARAMS: import('./vegetation-placer').VegetationParams = {
  brush: BRUSH,
  tileType: 'scrubland',
  kinds: canopyOf('scrubland'),
  density: 0.20,
  scaleRange: [0.8, 1.2],   // per-instance variety multiplier on metric height (±20%, scrub varies more)
  rotationRange: 0,         // species carry their own form; no tilt (looked wrong on trees/shrubs)
  offsetRange: [0.35, 0.35],
  // Pool undergrowth (heath flowers) plus scattered field-stone for scrub texture.
  undergrowth: [...undergrowthOf('scrubland'), ['field-stone', 1.0, 0.02]],
};

export function scrublandBrush(region: Region, seed: number, ctx: BrushContext): Entity[] {
  return placeVegetation(region, seed, ctx, SCRUBLAND_PARAMS);
}

registerBrush(BRUSH, scrublandBrush);
