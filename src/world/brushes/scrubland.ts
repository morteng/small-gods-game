import { placeVegetation, slopeBandAll, dustBandAll, COVER_SLOPE, STONE_SLOPE } from './vegetation-placer';
import { placeGrassCover } from './grassland';
import { registerBrush } from '@/world/brushes';
import { canopyOf, undergrowthOf } from '@/flora/biome-flora';
import type { Entity, Region, BrushContext } from '@/core/types';

const BRUSH = 'scrubland';

const SCRUBLAND_PARAMS: import('./vegetation-placer').VegetationParams = {
  brush: BRUSH,
  tileType: 'scrubland',
  kinds: canopyOf('scrubland'),
  density: 0.25,             // raised 0.20→0.25 (~25%, density pass)
  scaleRange: [0.8, 1.2],   // per-instance variety multiplier on metric height (±20%, scrub varies more)
  rotationRange: 0,         // species carry their own form; no tilt (looked wrong on trees/shrubs)
  offsetRange: [0.35, 0.35],
  // Pool undergrowth (heath flowers) plus scattered field-stone for scrub texture.
  undergrowth: [...undergrowthOf('scrubland'), ['field-stone', 1.0, 0.02]],
  openUndergrowth: 0.8,     // raised 0.5→0.8 (density pass): heath flowers belong in the open, not only under bushes
  // STEEPNESS: nothing roots on a cliff face — the terrain shader paints those
  // as bare rock. Canopy + undergrowth pools take the shared thinning bands.
  slope: {
    ...slopeBandAll(canopyOf('scrubland'), COVER_SLOPE),
    ...slopeBandAll(undergrowthOf('scrubland'), COVER_SLOPE),
    'field-stone': STONE_SLOPE,
  },
  // BARE GROUND: species-moisture derived — gorse/broom (dry) hold the scree,
  // the mesic heath flowers fade off it; the field-stone has no species and stays.
  dust: dustBandAll([...canopyOf('scrubland'), ...undergrowthOf('scrubland')]),
};

export function scrublandBrush(region: Region, seed: number, ctx: BrushContext): Entity[] {
  // Grassland biomes route here; their grass/meadow tiles (the majority) get meadow cover.
  return [...placeVegetation(region, seed, ctx, SCRUBLAND_PARAMS), ...placeGrassCover(region, seed, ctx)];
}

registerBrush(BRUSH, scrublandBrush);
