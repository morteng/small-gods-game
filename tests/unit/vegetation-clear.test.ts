import { describe, it, expect } from 'vitest';
import {
  clearObstructedVegetation,
  isRoadOrRiver,
  TREE_CLEAR_RADIUS,
  UNDERGROWTH_CLEAR_RADIUS,
} from '@/world/vegetation-clear';
import { World } from '@/world/world';
import type { GameMap, Tile, Entity } from '@/core/types';
import type { RoadGraph } from '@/world/road-graph';

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
  return { id, kind: 'english-oak', x, y, tags: ['vegetation', 'tree'], properties: {} } as Entity;
}
function shrub(id: string, x: number, y: number): Entity {
  return { id, kind: 'shrub', x, y, tags: ['vegetation', 'undergrowth'], properties: {} } as Entity;
}
function cottage(id: string, x: number, y: number, w = 3, h = 3): Entity {
  return {
    id, kind: 'cottage', x, y, tags: ['building'],
    properties: { category: 'building', footprint: { w, h } },
  } as Entity;
}
/** A riparian rock — `granite-boulder` resolves to a clearable `vegetation` def; the
 *  `waterPlaced` tag (optional) is what the riparian pass stamps to exempt it. */
function boulder(id: string, x: number, y: number, tags: string[] = ['vegetation', 'rock']): Entity {
  return { id, kind: 'granite-boulder', x, y, tags, properties: {} } as Entity;
}

/** A one-edge road graph whose polyline runs through the given points. */
function roadGraphLine(pts: { x: number; y: number }[]): RoadGraph {
  return {
    nodes: [],
    edges: [{ id: 'e', a: 'n0', b: 'n1', polyline: pts, feature: 'road', class: 'road', surface: 'dirt', bridgeCells: [] }],
  };
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

describe('clearObstructedVegetation — tile proximity', () => {
  it('removes vegetation on a road/river tile, keeps what is well clear', () => {
    const map = makeMap(14, 14);
    map.tiles[2][2].type = 'river';
    map.tiles[0][0].type = 'dirt_road';
    const world = new World(map);
    world.addEntity(tree('on-river', 2, 2));
    world.addEntity(tree('on-road', 0, 0));
    world.addEntity(tree('far', 12, 12)); // well beyond any canopy radius
    world.addEntity(shrub('far-shrub', 11, 2));

    const removed = clearObstructedVegetation(world, map);

    expect(removed).toBe(2);
    expect(world.registry.get('on-river')).toBeUndefined();
    expect(world.registry.get('on-road')).toBeUndefined();
    expect(world.registry.get('far')).toBeDefined();
    expect(world.registry.get('far-shrub')).toBeDefined();
  });

  it('is canopy-aware: a tree clears farther from the corridor than undergrowth', () => {
    const map = makeMap(14, 14);
    map.tiles[5][5].type = 'dirt_road';
    const world = new World(map);
    // Both sit 1.58 tiles from the road cell centre — inside the tree radius
    // (2.2) but outside the undergrowth radius (1.2).
    world.addEntity(tree('canopy', 5, 7));
    world.addEntity(shrub('low', 6, 7));

    clearObstructedVegetation(world, map);

    expect(TREE_CLEAR_RADIUS).toBeGreaterThan(UNDERGROWTH_CLEAR_RADIUS);
    expect(world.registry.get('canopy')).toBeUndefined(); // overhanging tree cleared
    expect(world.registry.get('low')).toBeDefined();       // low scrub survives
  });
});

describe('clearObstructedVegetation — road-graph centerline', () => {
  it('clears a tree under a road-graph polyline that crosses no road tile', () => {
    // All-grass tiles: the only road signal is the graph's centerline, exactly the
    // case where the swept ribbon leaves the rasterized cells.
    const map = makeMap(14, 14);
    map.roadGraph = roadGraphLine([{ x: 1, y: 5 }, { x: 12, y: 5 }]);
    const world = new World(map);
    world.addEntity(tree('on-line', 6, 5)); // sits on the centerline
    world.addEntity(tree('off-line', 6, 11)); // 6 tiles off — survives

    const removed = clearObstructedVegetation(world, map);

    expect(removed).toBe(1);
    expect(world.registry.get('on-line')).toBeUndefined();
    expect(world.registry.get('off-line')).toBeDefined();
  });
});

describe('clearObstructedVegetation — waterPlaced exemption (rivers slice 2)', () => {
  it('keeps a waterPlaced rock in the river but clears an untagged one', () => {
    const map = makeMap(14, 14);
    map.tiles[6][6].type = 'river';
    const world = new World(map);
    world.addEntity(boulder('riparian', 6, 6, ['vegetation', 'rock', 'waterPlaced']));
    world.addEntity(boulder('stray', 6, 6, ['vegetation', 'rock'])); // same cell, no tag

    const removed = clearObstructedVegetation(world, map);

    expect(removed).toBe(1);
    expect(world.registry.get('riparian')).toBeDefined();   // the point of a river
    expect(world.registry.get('stray')).toBeUndefined();     // ordinary nature, cleared
  });

  it('still clears a waterPlaced rock that ends up under a building footprint', () => {
    const map = makeMap(12, 12);
    const world = new World(map);
    world.addEntity(cottage('c', 2, 2)); // footprint (2,2)..(4,4)
    world.addEntity(boulder('under-building', 3, 3, ['vegetation', 'rock', 'waterPlaced']));

    const removed = clearObstructedVegetation(world, map);

    expect(removed).toBe(1);
    expect(world.registry.get('under-building')).toBeUndefined();
  });
});

describe('clearObstructedVegetation — buildings', () => {
  it('removes trees anywhere on a building footprint (not just the origin)', () => {
    const map = makeMap(12, 12);
    const world = new World(map);
    world.addEntity(cottage('c', 2, 2)); // footprint (2,2)..(4,4)
    world.addEntity(tree('origin', 2, 2));
    world.addEntity(tree('mid', 3, 3));
    world.addEntity(tree('corner', 4, 4));
    world.addEntity(tree('outside', 9, 9));

    const removed = clearObstructedVegetation(world, map);

    expect(removed).toBe(3);
    expect(world.registry.get('origin')).toBeUndefined();
    expect(world.registry.get('mid')).toBeUndefined();
    expect(world.registry.get('corner')).toBeUndefined();
    expect(world.registry.get('outside')).toBeDefined();
  });

  it('leaves the building itself and is idempotent', () => {
    const map = makeMap(12, 12);
    const world = new World(map);
    world.addEntity(cottage('c', 2, 2));
    world.addEntity(tree('mid', 3, 3));

    expect(clearObstructedVegetation(world, map)).toBe(1);
    expect(world.registry.get('c')).toBeDefined();
    // Second run finds nothing left to clear.
    expect(clearObstructedVegetation(world, map)).toBe(0);
  });
});
