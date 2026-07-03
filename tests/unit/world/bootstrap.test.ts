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

  it('prewarms the trample grid: gen ships worn dirt lanes tracked on the grid', async () => {
    const result = await generateWithNoise(64, 64, 7, testSeed);
    const dirt = result.map.tiles.flat().filter(t => t.type === 'dirt');
    expect(dirt.length).toBeGreaterThan(0);          // settlement shows worn ground
    const snap = result.trample.serialize();
    expect(snap.promoted.length).toBeGreaterThan(0); // some of it is a tracked trail
    // Grid↔map consistency: every cell the grid calls a trail IS dirt on the map,
    // so the runtime decay/revert pass can act on it. (Authored dirt — market
    // plazas, POI ground patches — is NOT tracked and is left untouched by trample.)
    for (const [i] of snap.promoted) {
      const x = i % result.map.width;
      const y = (i - x) / result.map.width;
      expect(result.map.tiles[y][x].type).toBe('dirt');
      expect(result.trample.isPromoted(x, y)).toBe(true);
    }
  });

  it('trample prewarm is deterministic (grid identical for a fixed seed)', async () => {
    const a = await generateWithNoise(64, 64, 42, testSeed);
    const b = await generateWithNoise(64, 64, 42, testSeed);
    expect(a.trample.serialize()).toEqual(b.trample.serialize());
  });
});
