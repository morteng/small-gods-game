import { describe, it, expect } from 'vitest';
import { generateWithNoise } from '@/map/map-generator';
import type { WorldSeed } from '@/core/types';
import '@/world/brushes/index';

/** A minimal WorldSeed with a village (triggers building placement) and no
 *  connections, so the test stays fast and deterministic. */
const testSeed: WorldSeed = {
  name: 'bootstrap-test',
  size: { width: 64, height: 64 },
  biome: 'temperate',
  pois: [
    {
      id: 'test_village',
      type: 'village',
      name: 'Test Village',
      position: { x: 32, y: 32 },
      size: 'medium',
      description: 'A test settlement.',
    },
  ],
  connections: [],
  constraints: [],
};

describe('bootstrap world generation', () => {
  it('returns a World with both building and vegetation entities', async () => {
    const result = await generateWithNoise(64, 64, 1, testSeed);
    expect(result.world).toBeDefined();

    // Buildings — from settlement placement
    const buildings = result.world.query({ tag: 'building' });
    expect(buildings.length).toBeGreaterThan(0);

    // Trees — from biome brushes
    const trees = result.world.query({ tag: 'tree' });
    expect(trees.length).toBeGreaterThan(50);
  });

  it('is deterministic — same seed produces same total entity count', async () => {
    const r1 = await generateWithNoise(64, 64, 42, testSeed);
    const r2 = await generateWithNoise(64, 64, 42, testSeed);
    expect(r1.world.query({}).length).toBe(r2.world.query({}).length);
  });
});
