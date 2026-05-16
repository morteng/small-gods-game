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
});
