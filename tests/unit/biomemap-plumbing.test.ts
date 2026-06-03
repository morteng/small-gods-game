import { describe, it, expect } from 'vitest';
import { generateWithNoise } from '@/map/map-generator';
import type { WorldSeed } from '@/core/types';

const seed = (): WorldSeed => ({
  name: 'test',
  size: { width: 32, height: 32 },
  biome: 'temperate',
  pois: [],
  connections: [],
  constraints: [],
});

describe('generateWithNoise biomeMap', () => {
  it('returns a biomeMap sized width*height so state.biomeMap can be persisted', async () => {
    const { biomeMap, map } = await generateWithNoise(32, 32, 1, seed());
    expect(biomeMap).toBeTruthy();
    expect(biomeMap.width).toBe(32);
    expect(biomeMap.height).toBe(32);
    expect(biomeMap.biomes).toHaveLength(map.width * map.height);
    expect(typeof biomeMap.biomes[0]).toBe('string');
  });
});
