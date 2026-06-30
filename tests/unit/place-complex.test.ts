import { describe, it, expect } from 'vitest';
import { generateWithNoise } from '@/map/map-generator';
import { placeComplexOnPatch } from '@/world/place-complex';
import { getComposedHeightfield } from '@/world/road-deformation';
import { heightMetresAt } from '@/world/heightfield';
import { worldStyleOf } from '@/core/world-style';
import type { Entity, WorldSeed } from '@/core/types';

const seed: WorldSeed = {
  name: 'site-patch', size: { width: 64, height: 64 }, biome: 'temperate',
  pois: [], connections: [], constraints: [],
} as unknown as WorldSeed;

describe('placeComplexOnPatch (motte-and-bailey)', () => {
  it('places rings + keep + bailey and raises the motte on low ground', async () => {
    const { map, world } = await generateWithNoise(64, 64, 7, seed);
    const W = map.width;
    // Lowest interior cell → the motte is genuinely needed (a hill correctly gets none).
    let centre = { x: 32, y: 32 }, lowest = Infinity;
    for (let y = 12; y < 52; y++) for (let x = 12; x < 52; x++) {
      const h = heightMetresAt(map, x, y);
      if (h < lowest) { lowest = h; centre = { x, y }; }
    }
    const relief = worldStyleOf(map.worldSeed).mountainRelief;
    const before = getComposedHeightfield(map).slice();

    const res = placeComplexOnPatch(world, map, {
      complexTypeId: 'motte_and_bailey', centre, seed: 7, era: 'medieval',
    });

    // Two concentric palisade rings, a keep, and the bailey buildings, all resolved.
    expect(res.barriers.length).toBe(2);
    expect(res.buildingIds.some((id) => id.includes('castle_keep'))).toBe(true);
    expect(res.buildingIds.length).toBeGreaterThanOrEqual(2);
    expect(res.skippedBuildings).toHaveLength(0);          // every ward building synthesised

    // Entities are live in the world (render-ready).
    const ents = world.query({}) as Entity[];
    expect(ents.filter((e) => e.kind.endsWith('_run')).length).toBe(2);
    expect(ents.filter((e) => !!(e.properties as Record<string, unknown>)?.blueprint).length)
      .toBeGreaterThanOrEqual(res.buildingIds.length);

    // Spoil conserved, and the motte actually lifts the ground at centre.
    expect(Math.abs(res.placed?.netVolume ?? 1)).toBeLessThan(1e-6);
    const after = getComposedHeightfield(map);
    const riseM = (after[centre.y * W + centre.x] - before[centre.y * W + centre.x]) * relief;
    expect(riseM).toBeGreaterThan(0.5);
  });
});
