import { placeVegetation, slopeBandAll, dustBandAll, TREE_SLOPE, COVER_SLOPE } from './vegetation-placer';
import { placeGrassCover } from './grassland';
import { registerBrush } from '@/world/brushes';
import { canopyOf, undergrowthOf } from '@/flora/biome-flora';
import type { Entity, Region, BrushContext } from '@/core/types';

const BRUSH = 'dense_forest';

const DENSE_FOREST_PARAMS: import('./vegetation-placer').VegetationParams = {
  brush: BRUSH,
  tileType: 'dense_forest',
  kinds: canopyOf('dense_forest'),
  density: 0.53,              // raised 0.42→0.53 (~25%, density pass)
  scaleRange: [0.85, 1.15],   // per-instance variety multiplier on metric height (±15%)
  rotationRange: 0,
  offsetRange: [0.5, 0.5],
  maxPerTile: 2,
  undergrowth: undergrowthOf('dense_forest'),
  openUndergrowth: 0.75,      // raised 0.25→0.75 (density pass): ferns/bramble/hazel fill clearings too
  // TREELINE: broadleaf thins toward the upper forest fringe (see forest.ts).
  altitude: {
    'english-oak': { maxHeightM: 15, bandM: 6 },
    'european-beech': { maxHeightM: 15, bandM: 6 },
    'silver-birch': { maxHeightM: 19, bandM: 5 },
  },
  // STEEPNESS: nothing roots on a cliff face — the terrain shader paints those
  // as bare rock. Canopy + undergrowth pools take the shared thinning bands.
  slope: {
    ...slopeBandAll(canopyOf('dense_forest'), TREE_SLOPE),
    ...slopeBandAll(undergrowthOf('dense_forest'), COVER_SLOPE),
  },
  // BARE GROUND: species-moisture derived (dustBandAll), same rule as every brush.
  dust: dustBandAll([...canopyOf('dense_forest'), ...undergrowthOf('dense_forest')]),
};

export function denseForestBrush(region: Region, seed: number, ctx: BrushContext): Entity[] {
  return [...placeVegetation(region, seed, ctx, DENSE_FOREST_PARAMS), ...placeGrassCover(region, seed, ctx)];
}

registerBrush(BRUSH, denseForestBrush);
