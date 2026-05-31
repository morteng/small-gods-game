import { describe, it, expect } from 'vitest';
import { findPath, isWalkable } from '@/sim/pathfinding';
import { tileBlockedByBuilding } from '@/world/building-collision';
import { World } from '@/world/world';
import type { GameMap, Tile, Entity } from '@/core/types';

function makeMap(w: number, h: number): GameMap {
  const tiles: Tile[][] = [];
  for (let y = 0; y < h; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < w; x++) {
      row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
    }
    tiles.push(row);
  }
  return {
    tiles, width: w, height: h, villages: [], seed: 1, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [],
  };
}

function cottage(id: string, x: number, y: number, w = 3, h = 3): Entity {
  return {
    id, kind: 'cottage', x, y, tags: ['building'],
    properties: { category: 'building', footprint: { w, h } },
  } as Entity;
}

describe('building collision — footprint is the collider', () => {
  it('blocks EVERY footprint cell, not just the origin corner', () => {
    const map = makeMap(8, 8);
    const world = new World(map);
    world.addEntity(cottage('c', 2, 2)); // footprint (2,2)..(4,4)

    for (let y = 2; y <= 4; y++) {
      for (let x = 2; x <= 4; x++) {
        expect(tileBlockedByBuilding(world, x, y)).toBe(true);
        expect(isWalkable(map, x, y, world)).toBe(false);
      }
    }
  });

  it('leaves the surrounding ring walkable', () => {
    const map = makeMap(8, 8);
    const world = new World(map);
    world.addEntity(cottage('c', 2, 2));
    expect(isWalkable(map, 1, 3, world)).toBe(true); // west of footprint
    expect(isWalkable(map, 5, 3, world)).toBe(true); // east
    expect(isWalkable(map, 3, 1, world)).toBe(true); // north
    expect(isWalkable(map, 3, 5, world)).toBe(true); // south
  });

  it('A* routes AROUND the footprint instead of straight through it', () => {
    const map = makeMap(9, 9);
    const world = new World(map);
    world.addEntity(cottage('c', 3, 3)); // footprint (3,3)..(5,5)

    const result = findPath(map, 4, 1, 4, 7, world); // straight line crosses (4,3),(4,4),(4,5)
    expect(result).not.toBeNull();
    for (const step of result!.path) {
      expect(tileBlockedByBuilding(world, step.x, step.y)).toBe(false);
    }
  });

  it('does not block an NPC standing inside its own excluded tile', () => {
    const map = makeMap(8, 8);
    const world = new World(map);
    const npc: Entity = {
      id: 'n', kind: 'npc', x: 3, y: 3, tags: [], properties: {},
    } as Entity;
    world.addEntity(npc);
    // NPC alone is not a building → never blocks.
    expect(tileBlockedByBuilding(world, 3, 3)).toBe(false);
    expect(tileBlockedByBuilding(world, 3, 3, 'n')).toBe(false);
  });
});
