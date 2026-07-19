// Desert ground cover — hot arid ground reads MOSTLY BARE. A sparse scatter of
// salt-tolerant shrubs (tamarisk/wormwood), esparto tussocks and the odd thistle,
// clumped around nothing in particular, over the sand/rocky/dirt/scrubland tiles of
// a desert region. Density is well under the grassland brush's 0.40 by design —
// deserts are defined by their emptiness. Previously desert biomes mapped to the
// scrubland brush, dressing their scrubland tiles with temperate hedgerow thorns
// and leaving the sand majority barren; this gives arid ground its own ecology.
import { placeVegetation, slopeBandAll, COVER_SLOPE, type VegetationParams } from './vegetation-placer';
import { registerBrush } from '@/world/brushes';
import { canopyOf, undergrowthOf } from '@/flora/biome-flora';
import type { Entity, Region, BrushContext } from '@/core/types';

const BRUSH = 'desert';

const DESERT_PARAMS: VegetationParams = {
  brush: BRUSH,
  tileType: ['sand', 'rocky', 'dirt', 'scrubland'],
  kinds: canopyOf('desert'),
  density: 0.11,            // sparse — deserts read empty (cf. grassland 0.40)
  maxPerTile: 1,
  clumpScale: 6,            // broad clumps: an oasis-ish thicket, then long bare stretches
  scaleRange: [0.75, 1.25],
  rotationRange: 0,
  offsetRange: [0.5, 0.5],
  undergrowth: undergrowthOf('desert'),
  openUndergrowth: 1,       // the wormwood/thistle undergrowth belongs in the open
  // STEEPNESS: desert scrub roots in loose ground, not on the rock faces the
  // shader paints bare (mesa walls, canyon sides stay clean).
  slope: {
    ...slopeBandAll(canopyOf('desert'), COVER_SLOPE),
    ...slopeBandAll(undergrowthOf('desert'), COVER_SLOPE),
  },
};

export function desertBrush(region: Region, seed: number, ctx: BrushContext): Entity[] {
  return placeVegetation(region, seed, ctx, DESERT_PARAMS);
}

registerBrush(BRUSH, desertBrush);
