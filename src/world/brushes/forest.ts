import { placeVegetation, slopeBandAll, dustBandAll, TREE_SLOPE, COVER_SLOPE } from './vegetation-placer';
import { placeGrassCover } from './grassland';
import { registerBrush } from '@/world/brushes';
import { canopyOf, undergrowthOf } from '@/flora/biome-flora';
import type { Entity, Region, BrushContext } from '@/core/types';

const BRUSH = 'forest';

const FOREST_PARAMS: import('./vegetation-placer').VegetationParams = {
  brush: BRUSH,
  tileType: 'forest',
  kinds: canopyOf('forest'),
  density: 0.30,             // raised 0.24→0.30 (~25%, density pass)
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
  openUndergrowth: 0.8,     // raised 0.35→0.8 (density pass): ferns/bramble fill clearings, not only tree shade
  // TREELINE: broadleaf canopy is a LOWLAND cover — it thins out well below the
  // conifer treeline, so the upper forest fringe reads as birch/pine then bare.
  // (Forest tiles only classify below the 19 m mountain line, so these bands bite
  // the cold upper-forest band before the rock brush takes over.)
  altitude: {
    'english-oak': { maxHeightM: 15, bandM: 6 },
    'european-beech': { maxHeightM: 15, bandM: 6 },
    'european-ash': { maxHeightM: 15, bandM: 6 },
    'small-leaved-lime': { maxHeightM: 14, bandM: 5 },
    'silver-birch': { maxHeightM: 19, bandM: 5 },   // hardy pioneer climbs higher
  },
  // STEEPNESS: nothing roots on a cliff face — the terrain shader paints those
  // as bare rock. Canopy + undergrowth pools take the shared thinning bands.
  slope: {
    ...slopeBandAll(canopyOf('forest'), TREE_SLOPE),
    ...slopeBandAll(undergrowthOf('forest'), COVER_SLOPE),
  },
  // BARE GROUND: the forest floor obeys the painted dust the same way the meadow does
  // (species-moisture derived) — a fern rooted in painted scree was the residual the
  // grassland-only gate left open.
  dust: dustBandAll([...canopyOf('forest'), ...undergrowthOf('forest')]),
};

export function forestBrush(region: Region, seed: number, ctx: BrushContext): Entity[] {
  // Grass/meadow/glen tiles inside forest regions get open meadow cover too.
  return [...placeVegetation(region, seed, ctx, FOREST_PARAMS), ...placeGrassCover(region, seed, ctx)];
}

registerBrush(BRUSH, forestBrush);
