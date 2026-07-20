import { placeVegetation, slopeBandAll, dustBandAll, CONIFER_SLOPE, COVER_SLOPE } from './vegetation-placer';
import { placeGrassCover } from './grassland';
import { registerBrush } from '@/world/brushes';
import { canopyOf, undergrowthOf } from '@/flora/biome-flora';
import type { Entity, Region, BrushContext } from '@/core/types';

const BRUSH = 'pine_forest';

const PINE_FOREST_PARAMS: import('./vegetation-placer').VegetationParams = {
  brush: BRUSH,
  tileType: 'pine_forest',
  kinds: canopyOf('pine_forest'),
  density: 0.40,              // raised 0.32→0.40 (~25%, density pass)
  scaleRange: [0.85, 1.15],   // per-instance variety multiplier on metric height (±15%)
  rotationRange: 0,
  offsetRange: [0.5, 0.5],
  maxPerTile: 2,
  undergrowth: undergrowthOf('pine_forest'),
  openUndergrowth: 0.8,     // raised 0.35→0.8 (density pass): juniper/heather in the open too — pine floors read bare at 0.25
  // TREELINE: conifers hold the highest wooded ground — they thin toward the
  // treeline, above which only the alpine shrub/tussock/rock brush persists.
  altitude: {
    'scots-pine': { maxHeightM: 22, bandM: 8 },
    'norway-spruce': { maxHeightM: 21, bandM: 8 },
    'silver-birch': { maxHeightM: 19, bandM: 5 },
  },
  // STEEPNESS: conifers cling to steeper ground than broadleaf but still let go
  // of the faces the shader paints as bare rock.
  slope: {
    ...slopeBandAll(canopyOf('pine_forest'), CONIFER_SLOPE),
    ...slopeBandAll(undergrowthOf('pine_forest'), COVER_SLOPE),
  },
  // BARE GROUND: species-moisture derived (dustBandAll) — the dry heath/juniper floor
  // survives painted scree, the mesic pines fade off it.
  dust: dustBandAll([...canopyOf('pine_forest'), ...undergrowthOf('pine_forest')]),
};

export function pineForestBrush(region: Region, seed: number, ctx: BrushContext): Entity[] {
  return [...placeVegetation(region, seed, ctx, PINE_FOREST_PARAMS), ...placeGrassCover(region, seed, ctx)];
}

registerBrush(BRUSH, pineForestBrush);
