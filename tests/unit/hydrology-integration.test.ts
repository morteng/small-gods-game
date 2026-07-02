import { describe, it, expect } from 'vitest';
import { generateWithNoise } from '@/map/map-generator';
import type { WorldSeed } from '@/core/types';

const noPoiSeed: WorldSeed = {
  name: 'test',
  size: { width: 64, height: 64 },
  biome: 'temperate',
  pois: [],
  connections: [],
  constraints: [],
};

describe('Hydrology in generateWithNoise', () => {
  it('produces at least one river tile on a 64×64 map with default seed', async () => {
    const { map } = await generateWithNoise(64, 64, 1, noPoiSeed);
    let rivers = 0;
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        if (map.tiles[y]?.[x]?.type === 'river') rivers++;
      }
    }
    expect(rivers).toBeGreaterThan(0);
  });

  it('rivers are not walkable', async () => {
    const { map } = await generateWithNoise(64, 64, 1, noPoiSeed);
    let walkableRivers = 0;
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        const t = map.tiles[y]?.[x];
        if (t?.type === 'river' && t.walkable) walkableRivers++;
      }
    }
    expect(walkableRivers).toBe(0);
  });

  it('produces a reasonable number of river tiles at game map size (128×96)', async () => {
    const seed: WorldSeed = {
      name: 'test',
      size: { width: 128, height: 96 },
      biome: 'temperate',
      pois: [],
      connections: [],
      constraints: [],
    };
    const { map } = await generateWithNoise(128, 96, 1, seed);
    let rivers = 0;
    for (let y = 0; y < 96; y++) {
      for (let x = 0; x < 128; x++) {
        if (map.tiles[y]?.[x]?.type === 'river') rivers++;
      }
    }
    // Calibrated for the WIDE river raster (WORLD_CONTENT_VERSION 42): the tile
    // raster is stamped out to the connectome channel half-width (the same swath the
    // render mask + carve use) instead of the 1-cell D8 centreline, so the count is
    // ~4–5× the old centreline figure — seed=1 produces ~1300 rivers at the default
    // threshold of 500. The band is still bounded (it never sheets across the map);
    // the tolerance allows tuning the half-widths without brittleness.
    expect(rivers).toBeGreaterThanOrEqual(500);
    expect(rivers).toBeLessThanOrEqual(2200);
  });

  it('the river-flow threshold scales with map area (large maps do not over-river)', async () => {
    const { areaScaledRiverThreshold, DEFAULT_RIVER_FLOW_THRESHOLD } = await import('@/terrain/hydrology');
    // Small + reference maps stay at the tuned floor (byte-identical to before).
    expect(areaScaledRiverThreshold(64 * 64)).toBe(DEFAULT_RIVER_FLOW_THRESHOLD);
    expect(areaScaledRiverThreshold(128 * 96)).toBe(DEFAULT_RIVER_FLOW_THRESHOLD);
    // A large island (~8.5× the reference area) scales by its LINEAR dimension (√8.5 ≈ 2.9×),
    // not area — gentle enough to keep trunk rivers (linear ×8.5 over-corrected to zero).
    const big = areaScaledRiverThreshold(384 * 272);
    expect(big).toBeGreaterThan(DEFAULT_RIVER_FLOW_THRESHOLD * 2.5);
    expect(big).toBeLessThan(DEFAULT_RIVER_FLOW_THRESHOLD * 3.5);
  });

  it('styledRiverFlowThreshold = area-scaled ÷ riverDensity — THE one threshold every consumer derives', async () => {
    const { styledRiverFlowThreshold, areaScaledRiverThreshold } = await import('@/terrain/hydrology');
    // No style → area-scaled unchanged. This is the value the tile raster, the valley
    // carve, the render network AND the hydrology recompute must ALL classify against:
    // a fixed constant in any one of them made every reach `major_river` on large maps
    // (uniform max-depth trenches) or drew channels the tiles don't have.
    expect(styledRiverFlowThreshold(null, 488, 352)).toBe(areaScaledRiverThreshold(488 * 352));
    // riverDensity scales INVERSELY (>1 ⇒ lower threshold ⇒ more/finer rivers).
    const dense = styledRiverFlowThreshold({ style: { overrides: { riverDensity: 2 } } }, 488, 352);
    expect(dense).toBeCloseTo(areaScaledRiverThreshold(488 * 352) / 2, 6);
  });
});
