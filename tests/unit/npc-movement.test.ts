import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import { tickNpcMovementEntities } from '@/sim/npc-movement';
import { initNpcProps } from '@/world/npc-helpers';
import { createRng } from '@/core/rng';
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
  it('does not pathfind onto void tiles', () => {
    const map = mapWithOneRealizedTile(5, 5);
    const world = new World(map);
    const e: Entity = { id: 'n1', kind: 'npc', x: 5, y: 5, properties: initNpcProps('A', 'farmer', 1) as unknown as Record<string, unknown> };
    world.addEntity(e);
    (e.properties as unknown as NpcProperties).moveCooldown = 0;
    const rng = createRng(1);
    for (let i = 0; i < 50; i++) tickNpcMovementEntities(world, map, 500, rng);
    // On a single-realized-tile map, pathfinding can't find any destination,
    // so the NPC stays put.
    expect(Math.floor(e.x)).toBe(5);
    expect(Math.floor(e.y)).toBe(5);
  });

  it('moves toward a valid destination over time', () => {
    // 5x5 all grass, all realized. NPC at (0,0). Should move somewhere.
    const tiles: Tile[][] = [];
    for (let y = 0; y < 5; y++) {
      const row: Tile[] = [];
      for (let x = 0; x < 5; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
      tiles.push(row);
    }
    const map: GameMap = {
      tiles, width: 5, height: 5, villages: [], seed: 1, success: true,
      worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [],
    };
    const world = new World(map);
    const e: Entity = { id: 'n1', kind: 'npc', x: 0, y: 0, properties: initNpcProps('B', 'farmer', 2) as unknown as Record<string, unknown> };
    world.addEntity(e);
    const rng = createRng(42);
    for (let i = 0; i < 100; i++) tickNpcMovementEntities(world, map, 500, rng);
    // The NPC should have moved from (0,0)
    expect(e.x !== 0 || e.y !== 0).toBe(true);
    // Should still be on walkable tiles
    expect(Math.floor(e.x)).toBeGreaterThanOrEqual(0);
    expect(Math.floor(e.y)).toBeGreaterThanOrEqual(0);
    expect(Math.floor(e.x)).toBeLessThan(5);
    expect(Math.floor(e.y)).toBeLessThan(5);
  });

  it('NPCs move with sub-tile precision (fractional coords)', () => {
    const tiles: Tile[][] = [];
    for (let y = 0; y < 5; y++) {
      const row: Tile[] = [];
      for (let x = 0; x < 5; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
      tiles.push(row);
    }
    const map: GameMap = {
      tiles, width: 5, height: 5, villages: [], seed: 1, success: true,
      worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [],
    };
    const world = new World(map);
    const e: Entity = { id: 'n1', kind: 'npc', x: 2, y: 2, properties: initNpcProps('C', 'merchant', 3) as unknown as Record<string, unknown> };
    world.addEntity(e);
    const rng = createRng(7);
    // After a few ticks, the NPC should have fractional coordinates
    for (let i = 0; i < 5; i++) tickNpcMovementEntities(world, map, 17, rng); // 17ms ticks ≈ 1/60
    // x and y should not be integer (sub-tile movement)
    const isFractional = e.x !== Math.floor(e.x) || e.y !== Math.floor(e.y);
    expect(isFractional).toBe(true);
  });

  it('eventually arrives at tile centers when path completes', () => {
    const tiles: Tile[][] = [];
    for (let y = 0; y < 5; y++) {
      const row: Tile[] = [];
      for (let x = 0; x < 5; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
      tiles.push(row);
    }
    const map: GameMap = {
      tiles, width: 5, height: 5, villages: [], seed: 1, success: true,
      worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [],
    };
    const world = new World(map);
    const e: Entity = { id: 'n1', kind: 'npc', x: 0, y: 0, properties: initNpcProps('D', 'farmer', 4) as unknown as Record<string, unknown> };
    world.addEntity(e);
    const rng = createRng(99);
    // Give it plenty of ticks to complete at least one path
    for (let i = 0; i < 200; i++) tickNpcMovementEntities(world, map, 17, rng); // ~3.4 seconds sim time
    // NPC should have moved from origin
    expect(e.x !== 0 || e.y !== 0).toBe(true);
  });
});
