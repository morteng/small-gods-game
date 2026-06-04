import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import { buildingEntity } from '@/world/building-descriptor';
import { synthesizeFromPreset } from '@/world/building-presets';
import type { GameMap } from '@/core/types';

function emptyMap(): GameMap {
  return { tiles: [], width: 32, height: 32, villages: [], seed: 1, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] } as unknown as GameMap;
}

describe('descriptor building indexing', () => {
  it('registers every footprint cell in the registry tile index', () => {
    const world = new World(emptyMap());
    const d = synthesizeFromPreset('cottage')!;       // 3x3
    world.addEntity(buildingEntity('b1', d, 5, 5));
    for (let dy = 0; dy < 3; dy++) {
      for (let dx = 0; dx < 3; dx++) {
        const at = world.registry.getAtTile(5 + dx, 5 + dy).map(e => e.id);
        expect(at, `cell ${5 + dx},${5 + dy}`).toContain('b1');
      }
    }
    expect(world.registry.getAtTile(8, 8).map(e => e.id)).not.toContain('b1');
  });
});
