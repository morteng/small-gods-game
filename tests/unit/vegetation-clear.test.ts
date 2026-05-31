import { describe, it, expect } from 'vitest';
import { clearObstructedVegetation, isRoadOrRiver } from '@/world/vegetation-clear';
import { World } from '@/world/world';
import type { GameMap, Tile, Entity } from '@/core/types';

function makeMap(w: number, h: number, type = 'grass'): GameMap {
  const tiles: Tile[][] = [];
  for (let y = 0; y < h; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < w; x++) {
      row.push({ type, x, y, walkable: true, state: 'realized' });
    }
    tiles.push(row);
  }
  return {
    tiles, width: w, height: h, villages: [], seed: 1, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [],
  };
}

function tree(id: string, x: number, y: number): Entity {
  return { id, kind: 'oak_tree', x, y, tags: ['vegetation', 'tree'], properties: {} } as Entity;
}
function cottage(id: string, x: number, y: number, w = 3, h = 3): Entity {
  return {
    id, kind: 'cottage', x, y, tags: ['building'],
    properties: { category: 'building', footprint: { w, h } },
  } as Entity;
}

describe('isRoadOrRiver', () => {
  it('matches road/river/bridge variants, not grass', () => {
    expect(isRoadOrRiver('river')).toBe(true);
    expect(isRoadOrRiver('road_ns')).toBe(true);
    expect(isRoadOrRiver('dirt_road')).toBe(true);
    expect(isRoadOrRiver('stone_road_ew')).toBe(true);
    expect(isRoadOrRiver('bridge')).toBe(true);
    expect(isRoadOrRiver('grass')).toBe(false);
    expect(isRoadOrRiver('forest')).toBe(false);
  });
});

describe('clearObstructedVegetation', () => {
  it('removes trees that sit on a road or river tile', () => {
    const map = makeMap(5, 5);
    map.tiles[2][2].type = 'river';
    map.tiles[0][0].type = 'dirt_road';
    const world = new World(map);
    world.addEntity(tree('on-river', 2, 2));
    world.addEntity(tree('on-road', 0, 0));
    world.addEntity(tree('on-grass', 4, 4));

    const removed = clearObstructedVegetation(world, map);

    expect(removed).toBe(2);
    expect(world.registry.get('on-river')).toBeUndefined();
    expect(world.registry.get('on-road')).toBeUndefined();
    expect(world.registry.get('on-grass')).toBeDefined();
  });

  it('removes trees anywhere on a building footprint (not just the origin)', () => {
    const map = makeMap(8, 8);
    const world = new World(map);
    world.addEntity(cottage('c', 2, 2)); // footprint (2,2)..(4,4)
    world.addEntity(tree('origin', 2, 2));
    world.addEntity(tree('mid', 3, 3));
    world.addEntity(tree('corner', 4, 4));
    world.addEntity(tree('outside', 5, 5));

    const removed = clearObstructedVegetation(world, map);

    expect(removed).toBe(3);
    expect(world.registry.get('origin')).toBeUndefined();
    expect(world.registry.get('mid')).toBeUndefined();
    expect(world.registry.get('corner')).toBeUndefined();
    expect(world.registry.get('outside')).toBeDefined();
  });

  it('leaves the building itself and is idempotent', () => {
    const map = makeMap(8, 8);
    const world = new World(map);
    world.addEntity(cottage('c', 2, 2));
    world.addEntity(tree('mid', 3, 3));

    expect(clearObstructedVegetation(world, map)).toBe(1);
    expect(world.registry.get('c')).toBeDefined();
    // Second run finds nothing left to clear.
    expect(clearObstructedVegetation(world, map)).toBe(0);
  });
});
