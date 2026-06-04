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

  it('footprint material wins over own apron', () => {
    const world = new World(emptyMap());
    const keep = synthesizeFromPreset('castle_keep')!; // flagstone footprint, gravel apron r2
    world.addEntity(buildingEntity('k', keep, 10, 10)); // 4x4
    const field = computeGroundMaterialField(world);
    expect(field.get('11,11')).toBe('flagstone'); // footprint, not apron gravel
    expect(field.get('9,10')).toBe('gravel');     // apron actually visible
  });

  it('footprint of one building beats apron of a neighbour', () => {
    const world = new World(emptyMap());
    // castle_keep at (10,10): flagstone footprint 4x4 covers x=10..13, y=10..13
    world.addEntity(buildingEntity('a', synthesizeFromPreset('castle_keep')!, 10, 10));
    // cottage at (7,10): packed_dirt footprint 3x3 covers x=7..9; apron r1 reaches x=10 at y=10
    world.addEntity(buildingEntity('b', synthesizeFromPreset('cottage')!, 7, 10));
    const field = computeGroundMaterialField(world);
    // (10,10) is cottage's apron but castle_keep's footprint — flagstone wins
    expect(field.get('10,10')).toBe('flagstone');
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
