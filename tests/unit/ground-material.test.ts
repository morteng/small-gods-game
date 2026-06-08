import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import type { GameMap } from '@/core/types';
import { blueprintEntity } from '@/blueprint/entity';
import { synthesizeBlueprint } from '@/blueprint/presets';
import { computeGroundMaterialField } from '@/render/ground-material';

function emptyMap(w = 40, h = 40): GameMap {
  return { tiles: [], width: w, height: h, villages: [], seed: 1, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] } as unknown as GameMap;
}

describe('computeGroundMaterialField', () => {
  it('stamps the blueprint ground material under the building footprint', () => {
    const world = new World(emptyMap());
    const rb = synthesizeBlueprint('cottage')!;   // ground packed_dirt, 3x3 footprint
    world.addEntity(blueprintEntity('b1', rb, 10, 10));
    const field = computeGroundMaterialField(world);
    expect(field.get('11,11')).toBe('packed_dirt');  // under footprint (centre)
    expect(field.get('12,12')).toBe('packed_dirt');  // footprint corner (3x3 reaches 12)
    expect(field.get('20,20')).toBeUndefined();      // far away
    expect(field.get('13,13')).toBeUndefined();      // outside the footprint (apron dropped)
  });

  it('covers the whole footprint of a larger building', () => {
    const world = new World(emptyMap());
    const keep = synthesizeBlueprint('castle_keep')!; // gravel ground, 3x3 footprint
    world.addEntity(blueprintEntity('k', keep, 10, 10));
    const field = computeGroundMaterialField(world);
    expect(field.get('10,10')).toBe('gravel');
    expect(field.get('12,12')).toBe('gravel');
  });

  it('reverts (no entries) when the building is removed', () => {
    const world = new World(emptyMap());
    const rb = synthesizeBlueprint('cottage')!;
    world.addEntity(blueprintEntity('b1', rb, 10, 10));
    world.removeEntity('b1');
    const field = computeGroundMaterialField(world);
    expect(field.size).toBe(0);
  });
});
