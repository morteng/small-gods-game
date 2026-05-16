import { describe, it, expect } from 'vitest';
import { generateWithNoise } from '@/map/map-generator';
import type { WorldSeed } from '@/core/types';

const minimalSeed = (overrides: Partial<WorldSeed> = {}): WorldSeed => ({
  name: 'test',
  size: { width: 32, height: 32 },
  biome: 'temperate',
  pois: [
    { id: 'a', type: 'village', name: 'A', position: { x: 5,  y: 16 } },
    { id: 'b', type: 'village', name: 'B', position: { x: 26, y: 16 } },
  ],
  connections: [
    { from: 'a', to: 'b', type: 'road', style: 'dirt' },
  ],
  constraints: [],
  ...overrides,
});

describe('carveConnections (via generateWithNoise)', () => {
  it('writes road tiles along a straight east-west connection', async () => {
    const { map } = await generateWithNoise(32, 32, 1, minimalSeed());

    let roadCount = 0;
    for (let x = 5; x <= 26; x++) {
      const t = map.tiles[16]?.[x];
      if (t && (t.type === 'dirt_road' || t.type === 'bridge')) roadCount++;
    }
    expect(roadCount).toBeGreaterThanOrEqual(18);
  });
});
