import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import { tickNpcMovementEntities } from '@/sim/npc-movement';
import { initNpcProps } from '@/world/npc-helpers';
import type { GameMap, Tile, Entity, NpcProperties } from '@/core/types';

function mapWithOneRealizedTile(rx: number, ry: number): GameMap {
  const tiles: Tile[][] = [];
  for (let y = 0; y < 10; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < 10; x++) {
      row.push({
        type: 'grass', x, y, walkable: true,
        state: (x === rx && y === ry) ? 'realized' : 'void',
      });
    }
    tiles.push(row);
  }
  return {
    tiles, width: 10, height: 10, villages: [], seed: 1, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [],
  };
}

describe('tickNpcMovementEntities', () => {
  it('does not step onto void tiles', () => {
    const map = mapWithOneRealizedTile(5, 5);
    const world = new World(map);
    const e: Entity = { id: 'n1', kind: 'npc', x: 5, y: 5, properties: initNpcProps('A', 'farmer', 1) as unknown as Record<string, unknown> };
    world.addEntity(e);
    (e.properties as unknown as NpcProperties).moveCooldown = 0;
    for (let i = 0; i < 50; i++) tickNpcMovementEntities(world, map, 500);
    expect(Math.floor(e.x)).toBe(5);
    expect(Math.floor(e.y)).toBe(5);
  });
});
