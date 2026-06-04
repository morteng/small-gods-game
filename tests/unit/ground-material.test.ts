import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import type { GameMap } from '@/core/types';
import { buildingEntity } from '@/world/building-descriptor';
import { synthesizeFromPreset } from '@/world/building-presets';
import { computeGroundMaterialField } from '@/render/ground-material';

function emptyMap(w = 40, h = 40): GameMap {
  return { tiles: [], width: w, height: h, villages: [], seed: 1, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] } as unknown as GameMap;
}

describe('computeGroundMaterialField', () => {
  it('stamps footprint material under the building and apron material around it', () => {
    const world = new World(emptyMap());
    const d = synthesizeFromPreset('cottage')!;   // ground packed_dirt, apron r1 packed_dirt
    world.addEntity(buildingEntity('b1', d, 10, 10)); // 3x3 footprint
    const field = computeGroundMaterialField(world);
    expect(field.get('11,11')).toBe('packed_dirt');  // under footprint (centre)
    expect(field.get('9,10')).toBe('packed_dirt');   // apron ring (left of footprint)
    expect(field.get('20,20')).toBeUndefined();      // far away
  });

  it('footprint material wins over a neighbour apron', () => {
    const world = new World(emptyMap());
    const temple = synthesizeFromPreset('temple_small')!; // flagstone footprint + apron r2
    world.addEntity(buildingEntity('t', temple, 10, 10)); // 4x4
    const field = computeGroundMaterialField(world);
    expect(field.get('11,11')).toBe('flagstone');    // footprint, not apron
  });

  it('reverts (no entries) when the building is removed', () => {
    const world = new World(emptyMap());
    const d = synthesizeFromPreset('cottage')!;
    world.addEntity(buildingEntity('b1', d, 10, 10));
    world.removeEntity('b1');
    const field = computeGroundMaterialField(world);
    expect(field.size).toBe(0);
  });
});
