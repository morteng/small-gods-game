import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import type { GameMap } from '@/core/types';
import { buildingEntity } from '@/world/building-descriptor';
import { synthesizeFromPreset } from '@/world/building-presets';
import { tileBlockedByBuilding } from '@/world/building-collision';

function emptyMap(): GameMap {
  return { tiles: [], width: 32, height: 32, villages: [], seed: 1, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] } as unknown as GameMap;
}

describe('building door passability', () => {
  it('door cell is walkable, every other footprint cell is solid', () => {
    const world = new World(emptyMap());
    const d = synthesizeFromPreset('cottage')!;        // 3x3, door {1,2}
    world.addEntity(buildingEntity('b1', d, 5, 5));    // door at world (6, 7)
    expect(tileBlockedByBuilding(world, 6, 7)).toBe(false); // door
    expect(tileBlockedByBuilding(world, 5, 5)).toBe(true);  // corner
    expect(tileBlockedByBuilding(world, 6, 6)).toBe(true);  // centre
  });
});
