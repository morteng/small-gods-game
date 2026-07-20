// Open-ground GROUND COVER for 'grass' / 'meadow' / 'glen' tiles — the tile types
// that make up most of every grassland biome yet historically had no flora brush at
// all, which is why the world showed no grass, flowers or free-standing bushes.
//
// Exported as a helper (not only a registered brush) because grass tiles appear
// inside almost every biome's tile mix (forest 15%, scrubland 30%, beach 20%, …),
// and brushes run one-per-biome-region: each vegetation brush calls this for the
// grass tiles in ITS region, so meadows bloom wherever the tiles actually are.
import { placeVegetation, slopeBandAll, COVER_SLOPE, STONE_SLOPE } from './vegetation-placer';
import { registerBrush } from '@/world/brushes';
import { canopyOf, undergrowthOf } from '@/flora/biome-flora';
import type { Entity, Region, BrushContext } from '@/core/types';

const BRUSH = 'grassland';

const GRASSLAND_PARAMS: import('./vegetation-placer').VegetationParams = {
  brush: BRUSH,
  tileType: ['grass', 'meadow', 'glen'],
  kinds: canopyOf('grassland'),
  density: 0.40,          // raised 0.11→0.18→0.40 (density pass): open ground still read bare
  maxPerTile: 3,            // tussocks clump — up to three small plants in one cell reads natural
  clumpScale: 4,            // tight drifts: flower patches, not an even sprinkle
  scaleRange: [0.75, 1.25],
  rotationRange: 0,
  offsetRange: [0.5, 0.5],  // full-cell scatter — ground cover must not reveal the grid
  undergrowth: undergrowthOf('grassland'),
  openUndergrowth: 1,       // field-stones don't need a canopy
  // STEEPNESS: meadow cover fades off the faces the shader paints as rock; the
  // field-stone is LOOSE stone and obeys the tighter angle-of-repose band.
  slope: {
    ...slopeBandAll(canopyOf('grassland'), COVER_SLOPE),
    ...slopeBandAll(undergrowthOf('grassland'), COVER_SLOPE),
    'field-stone': STONE_SLOPE,
  },
  // BARE GROUND: meadow flowers/tufts fade off cells the shader paints as dust/pebbles
  // (the dust-mask mirror) — lush cover sprouting from painted scree was the giveaway
  // that placement never saw the paint. The field-stone stays: scree is its habitat.
  dust: Object.fromEntries(
    [...canopyOf('grassland'), ...undergrowthOf('grassland')]
      .map(([k]) => k)
      .filter((k) => k !== 'field-stone')
      .map((k) => [k, 1]),
  ),
};

/** Scatter grassland ground cover over the grass/meadow/glen tiles of `region`.
 *  Deterministic from (region, seed); safe to call from any biome brush. */
export function placeGrassCover(region: Region, seed: number, ctx: BrushContext): Entity[] {
  // Decorrelate from the calling brush's own placement rolls (same seed, same
  // hash function) so grass never lands in lockstep with that brush's canopy.
  return placeVegetation(region, seed ^ 0x9e37, ctx, GRASSLAND_PARAMS);
}

export function grasslandBrush(region: Region, seed: number, ctx: BrushContext): Entity[] {
  return placeGrassCover(region, seed, ctx);
}

registerBrush(BRUSH, grasslandBrush);
