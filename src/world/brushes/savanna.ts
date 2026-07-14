// Savanna / tropical-grassland ground cover — a dry grass SEA with very sparse thorn
// scrub, distinct from the temperate scrubland brush's hedgerow (hawthorn/blackthorn/
// gorse) look. The warm grasslands used to route through the scrubland brush and read
// as temperate heath; this gives them dry tussock + esparto with the odd lone thorn
// tree. Runs over the grass/scrubland/dirt tiles that make up a savanna region.
import { placeVegetation, type VegetationParams } from './vegetation-placer';
import { registerBrush } from '@/world/brushes';
import { canopyOf, undergrowthOf } from '@/flora/biome-flora';
import type { Entity, Region, BrushContext } from '@/core/types';

const BRUSH = 'savanna';

const SAVANNA_PARAMS: VegetationParams = {
  brush: BRUSH,
  tileType: ['grass', 'meadow', 'glen', 'scrubland', 'dirt'],
  kinds: canopyOf('savanna'),
  density: 0.34,            // a grass sea reads populated, but drier than temperate meadow
  maxPerTile: 3,            // tussocks clump
  clumpScale: 5,
  scaleRange: [0.75, 1.25],
  rotationRange: 0,
  offsetRange: [0.5, 0.5],
  undergrowth: undergrowthOf('savanna'),
  openUndergrowth: 1,
};

export function savannaBrush(region: Region, seed: number, ctx: BrushContext): Entity[] {
  return placeVegetation(region, seed, ctx, SAVANNA_PARAMS);
}

registerBrush(BRUSH, savannaBrush);
