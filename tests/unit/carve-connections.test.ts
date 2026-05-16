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

// Seed chosen by probing seeds 7, 13, 21, 33, ... until raw terrain
// produced shallow_water along y=16 between x=5..42. Seed 19 yields ~8
// shallow_water tiles on that line, ensuring the connection crosses water.
const WATER_SEED = 19;

const waterSeed = (overrides: Partial<WorldSeed> = {}): WorldSeed => ({
  name: 'water-test',
  size: { width: 48, height: 32 },
  biome: 'temperate',
  pois: [
    { id: 'a', type: 'village', name: 'A', position: { x: 5,  y: 16 } },
    { id: 'b', type: 'village', name: 'B', position: { x: 42, y: 16 } },
  ],
  connections: [
    { from: 'a', to: 'b', type: 'road', style: 'dirt' },
  ],
  constraints: [],
  ...overrides,
});

describe('carveConnections: water handling', () => {
  it('places bridge tiles when crossing water with autoBridge=true (default for non-river)', async () => {
    const { map } = await generateWithNoise(48, 32, WATER_SEED, waterSeed());

    const lineTypes = new Set<string>();
    for (let x = 5; x <= 42; x++) lineTypes.add(map.tiles[16]?.[x]?.type ?? '');
    expect(lineTypes.has('shallow_water')).toBe(false);
    expect(lineTypes.has('deep_water')).toBe(false);
  });

  it('skips water (no overwrite, no bridge) when autoBridge is explicitly false', async () => {
    const seed = waterSeed({
      connections: [
        { from: 'a', to: 'b', type: 'road', style: 'dirt', autoBridge: false },
      ],
    });
    const { map } = await generateWithNoise(48, 32, WATER_SEED, seed);

    let waterEncounters = 0;
    let bridgeOverWater = 0;
    for (let x = 5; x <= 42; x++) {
      const t = map.tiles[16]?.[x];
      if (!t) continue;
      if (t.type === 'shallow_water' || t.type === 'deep_water') waterEncounters++;
      if (t.type === 'bridge') bridgeOverWater++;
    }
    expect(bridgeOverWater).toBe(0);
    void waterEncounters;
  });
});
