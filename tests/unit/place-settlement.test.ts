import { describe, it, expect } from 'vitest';
import { generateWithNoise } from '@/map/map-generator';
import type { WorldSeed } from '@/core/types';

const singlePoiSeed = (
  type: string,
  overrides: Partial<WorldSeed> = {},
): WorldSeed => ({
  name: 'test',
  size: { width: 32, height: 32 },
  biome: 'temperate',
  pois: [{ id: 'p', type, name: type, position: { x: 16, y: 16 } }],
  connections: [],
  constraints: [],
  ...overrides,
});

describe('placeSettlement: village', () => {
  it('produces at least one building and at least one road tile for a village POI', async () => {
    const seed = singlePoiSeed('village', {
      pois: [
        { id: 'v', type: 'village', name: 'V', position: { x: 16, y: 16 } },
      ],
    });
    const { map } = await generateWithNoise(32, 32, 1, seed);

    expect(map.buildings.length).toBeGreaterThan(0);

    let roads = 0;
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
      const t = map.tiles[y]?.[x];
      if (t && (t.type === 'dirt_road' || t.type === 'stone_road')) roads++;
    }
    expect(roads).toBeGreaterThan(0);
  });
});
