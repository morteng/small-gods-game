import { describe, it, expect } from 'vitest';
import { generateWithNoise } from '@/map/map-generator';
import { getHeightfield, clearHeightfieldCache, ELEVATION_SEA_LEVEL } from '@/world/heightfield';
import { DEFAULT_ISLAND } from '@/terrain/island-mask';
import { WATER_TYPES } from '@/core/constants';
import type { WorldSeed } from '@/core/types';

/**
 * W1: the island flag must shape BOTH the biome/tile path (generateWithNoise) and
 * the render heightfield path (getHeightfield) identically — otherwise water
 * biomes and rendered terrain height disagree at the coast. These two paths build
 * their TerrainConfig separately, so this guards them against drift.
 */
function islandSeed(over: Partial<WorldSeed> = {}): WorldSeed {
  return {
    name: 'island-test',
    size: { width: 64, height: 64 },
    biome: 'temperate',
    pois: [],
    connections: [],
    constraints: [],
    island: true,
    ...over,
  };
}

describe('island worldgen ↔ heightfield consistency', () => {
  it('island world: border tiles are water in the generated map', async () => {
    clearHeightfieldCache();
    const ws = islandSeed();
    const { map } = await generateWithNoise(64, 64, 7, ws);
    const isWater = (x: number, y: number) => WATER_TYPES.has(map.tiles[y][x].type);
    for (let x = 0; x < 64; x++) {
      expect(isWater(x, 0)).toBe(true);
      expect(isWater(x, 63)).toBe(true);
    }
    for (let y = 0; y < 64; y++) {
      expect(isWater(0, y)).toBe(true);
      expect(isWater(63, y)).toBe(true);
    }
  });

  it('the render heightfield agrees: border elevation is below the waterline', () => {
    clearHeightfieldCache();
    const hf = getHeightfield(7, 64, 64, DEFAULT_ISLAND);
    for (let x = 0; x < 64; x++) {
      expect(hf[x]).toBeLessThan(ELEVATION_SEA_LEVEL);
      expect(hf[63 * 64 + x]).toBeLessThan(ELEVATION_SEA_LEVEL);
    }
  });

  it('a non-island world keeps land at the border in the heightfield (mask is opt-in)', () => {
    clearHeightfieldCache();
    const hfPlain = getHeightfield(7, 64, 64, /* island */ null);
    let landEdge = 0;
    for (let x = 0; x < 64; x++) if (hfPlain[x] >= ELEVATION_SEA_LEVEL) landEdge++;
    expect(landEdge).toBeGreaterThan(0);
  });

  it('island and non-island heightfields are cached independently (no key collision)', () => {
    clearHeightfieldCache();
    const island = getHeightfield(7, 64, 64, DEFAULT_ISLAND);
    const plain = getHeightfield(7, 64, 64, null);
    expect(island).not.toBe(plain);
    // Corner is fully sunk on the island, but plain noise leaves it (almost surely) different.
    expect(island[0]).toBeLessThan(plain[0] + 1e-6);
  });
});
