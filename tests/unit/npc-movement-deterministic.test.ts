import { describe, it, expect } from 'vitest';
import { createRng } from '@/core/rng';
import { World } from '@/world/world';
import { initNpcProps } from '@/world/npc-helpers';
import { tickNpcMovementEntities } from '@/sim/npc-movement';
import type { GameMap, Tile } from '@/core/types';

function makeWorldAndMap() {
  const tiles: Tile[][] = [];
  for (let y = 0; y < 20; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < 20; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
    tiles.push(row);
  }
  const map: GameMap = {
    tiles, width: 20, height: 20, villages: [], seed: 1, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [],
  };
  const world = new World(map);
  const props = initNpcProps('Alice', 'farmer', 42);
  world.addEntity({ id: 'n1', kind: 'npc', x: 10, y: 10, properties: props as unknown as Record<string, unknown> });
  return { world, map };
}

describe('NpcMovementSystem determinism', () => {
  it('same rng seed yields identical positions after N ticks', () => {
    const a = makeWorldAndMap();
    const b = makeWorldAndMap();
    const rngA = createRng(42);
    const rngB = createRng(42);
    for (let i = 0; i < 50; i++) {
      tickNpcMovementEntities(a.world, a.map, 500, rngA);
      tickNpcMovementEntities(b.world, b.map, 500, rngB);
    }
    const ea = a.world.registry.get('n1')!;
    const eb = b.world.registry.get('n1')!;
    expect({ x: ea.x, y: ea.y }).toEqual({ x: eb.x, y: eb.y });
  });
});
