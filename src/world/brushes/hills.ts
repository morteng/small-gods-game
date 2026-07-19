// Alpine / upland ground cover — the mountain, peak, ice and tundra brush. Routes
// through `placeVegetation` (hash01 accept + real intra-tile jitter + clumpScale)
// exactly like the grassland brush, so rock outcrops CLUMP organically instead of
// tiling. The old direct `noise()`-gated placement at exact tile centres (x+0.5)
// produced the "rock_pile, rock_pile, boulder" lattice repeating every few rows —
// `noise()` is a single correlated LCG step (see vegetation-placer's hash01 note).
//
// The primary pool mixes the alpine ROCK vocabulary (rocks aren't flora-DB species,
// so they live here, not in biome-flora) with dense tussock and the odd hardy dwarf
// shrub; the `alpine` biome-flora pool carries the heather/juniper undergrowth layer.
import { placeVegetation, STONE_SLOPE, COVER_SLOPE, type VegetationParams, type SlopeBand } from './vegetation-placer';
import { registerBrush } from '@/world/brushes';
import { undergrowthOf } from '@/flora/biome-flora';
import type { Entity, Region, BrushContext } from '@/core/types';

const BRUSH = 'hills';

// ── STEEPNESS BANDS — now the SHARED constants (vegetation-placer.ts), which carry
// this brush's original calibration story: STONE closes just past the angle of repose
// (rocks glued to a cliff face were the whole complaint), rooted COVER holds steeper
// (zero at 2.6 ≈ 52°) — enough to strip tussock/heather off the near-vertical faces
// without shaving the crags bare. Measured against the alpine ground's own slope
// distribution: p50 0.38–0.47, p90 1.15–1.26, p99 1.9–2.3, max ~11.6 (seeds 12345/777).
const ROCK_SLOPE: SlopeBand = STONE_SLOPE;

// Weights (sum ≈ 1) chosen against a measured density so tussock covers ~50–60% of
// upland cells and rocks ~25% (clumped): expected tussock/cell ≈ density·0.66 and
// rock/cell ≈ density·0.24 → coverage 1−e^(−exp). Rocks span the geology vocabulary
// (boulder → rock_pile → pebbles), with the standing stone a rare landscape accent.
// (`rock_small` has a blueprint preset but NO entity-kind def, and adding one would
// need a matching `NATURE_HEIGHT_M` entry in render/scale-contract — owned elsewhere
// this round, so it stays out of the pool rather than being forced in.)
export const ALPINE_PARAMS: VegetationParams = {
  brush: BRUSH,
  tileType: ['hills', 'mountain', 'peak', 'rocky'],
  kinds: [
    ['tussock-grass', 0.66],
    ['rock_pile', 0.12],
    ['boulder', 0.07],
    ['pebbles', 0.05],
    ['heather', 0.04],
    ['common-juniper', 0.03],
    ['gorse', 0.02],
    ['rock_outcrop', 0.012],
    ['standing_stone', 0.01],
  ],
  density: 1.0,             // ~7× the old effective rate; sized to keep whole worlds < ~37k entities
  maxPerTile: 3,            // several small plants/stones scatter across one cell
  clumpScale: 3,            // tight bouldery outcrops + tussock drifts, not an even sprinkle
  scaleRange: [0.7, 1.2],
  rotationRange: 0,
  offsetRange: [0.5, 0.5],  // full-cell scatter — ground cover must not reveal the grid
  undergrowth: undergrowthOf('alpine'),
  openUndergrowth: 1,       // the heath dwarf-shrubs don't need a canopy above them
  // Nothing in the alpine pool sits on a cliff FACE: the stones shed off it (repose),
  // the cover can't root on it. The undergrowth pool takes the cover band too.
  slope: {
    boulder: ROCK_SLOPE, rock_pile: ROCK_SLOPE, pebbles: ROCK_SLOPE, standing_stone: ROCK_SLOPE,
    rock_outcrop: ROCK_SLOPE,
    'tussock-grass': COVER_SLOPE, heather: COVER_SLOPE, 'common-juniper': COVER_SLOPE, gorse: COVER_SLOPE,
    ...Object.fromEntries(undergrowthOf('alpine').map(([k]) => [k, COVER_SLOPE])),
  },
};

export function hillsBrush(region: Region, seed: number, ctx: BrushContext): Entity[] {
  return placeVegetation(region, seed, ctx, ALPINE_PARAMS);
}

registerBrush(BRUSH, hillsBrush);
