import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import type { GameMap } from '@/core/types';
import { blueprintEntity } from '@/blueprint/entity';
import { synthesizeBlueprint } from '@/blueprint/presets';
import { tileBlockedByBuilding } from '@/world/building-collision';

function emptyMap(): GameMap {
  return { tiles: [], width: 32, height: 32, villages: [], seed: 1, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] } as unknown as GameMap;
}

describe('building door passability', () => {
  it('door cell is walkable, structure non-door cells are solid, lawn is walkable', () => {
    const world = new World(emptyMap());
    const rb = synthesizeBlueprint('cottage')!;        // 3x3 plot, 2x2 structure body, door {1,1}
    world.addEntity(blueprintEntity('b1', rb, 5, 5));  // door at world (6, 6)
    expect(tileBlockedByBuilding(world, 6, 6)).toBe(false); // door (1,1 relative)
    expect(tileBlockedByBuilding(world, 5, 5)).toBe(true);  // structure corner (0,0)
    expect(tileBlockedByBuilding(world, 5, 6)).toBe(true);  // structure cell (0,1)
    expect(tileBlockedByBuilding(world, 7, 7)).toBe(false); // lawn (2,2 — outside structure)
  });
});
