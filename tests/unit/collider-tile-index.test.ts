/**
 * The collider half of the registry's tile index.
 *
 * `byTile` holds EVERY body standing on a cell, mortals included. Collision only
 * ever cares about the solid ones, and once Phase 2 sent a whole settlement to
 * one gathering tile, reading the full list made a single walkability test cost
 * O(crowd) — and pathfinding, which tests walkability for every A* neighbour,
 * cost O(population²). `getCollidersAtTile` is the crowd-independent read.
 *
 * These tests pin the two halves of that claim: nothing that used to block stops
 * blocking, and a crowd of mortals adds nothing to the collider index.
 */
import { describe, it, expect } from 'vitest';
import { isWalkable } from '@/sim/pathfinding';
import { tileBlockedByBuilding } from '@/world/building-collision';
import { World } from '@/world/world';
import type { GameMap, Tile, Entity } from '@/core/types';

function makeMap(w: number, h: number): GameMap {
  const tiles: Tile[][] = [];
  for (let y = 0; y < h; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < w; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
    tiles.push(row);
  }
  return {
    tiles, width: w, height: h, villages: [], seed: 1, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [],
  };
}

function npc(id: string, x: number, y: number, tags?: string[]): Entity {
  return { id, kind: 'npc', x, y, tags, properties: { name: id } } as unknown as Entity;
}

function cottage(id: string, x: number, y: number): Entity {
  return {
    id, kind: 'cottage', x, y, tags: ['building'],
    properties: { category: 'building', footprint: { w: 3, h: 3 } },
  } as unknown as Entity;
}

function boulder(id: string, x: number, y: number): Entity {
  return { id, kind: 'boulder', x, y, tags: ['obstacle'], properties: {} } as unknown as Entity;
}

describe('collider tile index', () => {
  it('a crowd of mortals on one tile contributes NO colliders', () => {
    const map = makeMap(8, 8);
    const world = new World(map);
    for (let i = 0; i < 200; i++) world.addEntity(npc(`m${i}`, 4, 4));

    expect(world.registry.getAtTile(4, 4)).toHaveLength(200);   // still all there
    expect(world.registry.getCollidersAtTile(4, 4)).toEqual([]); // none of them solid
    expect(isWalkable(map, 4, 4, world)).toBe(true);
  });

  it('a building under the crowd still blocks', () => {
    const map = makeMap(8, 8);
    const world = new World(map);
    world.addEntity(cottage('c', 3, 3)); // (3,3)..(5,5)
    for (let i = 0; i < 50; i++) world.addEntity(npc(`m${i}`, 4, 4));

    expect(world.registry.getCollidersAtTile(4, 4).map((e) => e.id)).toEqual(['c']);
    expect(tileBlockedByBuilding(world, 4, 4)).toBe(true);
    expect(isWalkable(map, 4, 4, world)).toBe(false);
  });

  it('an obstacle-tagged prop still blocks, and every footprint cell is indexed', () => {
    const map = makeMap(8, 8);
    const world = new World(map);
    world.addEntity(boulder('b', 2, 2));
    world.addEntity(cottage('c', 4, 4));

    expect(isWalkable(map, 2, 2, world)).toBe(false);
    for (let y = 4; y <= 6; y++) {
      for (let x = 4; x <= 6; x++) expect(world.registry.getCollidersAtTile(x, y).map((e) => e.id)).toEqual(['c']);
    }
  });

  it('an obstacle-TAGGED mortal is still a collider (the tag re-arms a soft kind)', () => {
    const map = makeMap(8, 8);
    const world = new World(map);
    world.addEntity(npc('possessed', 3, 3, ['obstacle']));
    expect(world.registry.getCollidersAtTile(3, 3).map((e) => e.id)).toEqual(['possessed']);
    expect(isWalkable(map, 3, 3, world)).toBe(false);
  });

  it('follows a collider that moves, and forgets one that is removed', () => {
    const map = makeMap(8, 8);
    const world = new World(map);
    world.addEntity(boulder('b', 2, 2));

    world.registry.update('b', { x: 5, y: 5 });
    expect(world.registry.getCollidersAtTile(2, 2)).toEqual([]);
    expect(world.registry.getCollidersAtTile(5, 5).map((e) => e.id)).toEqual(['b']);
    expect(isWalkable(map, 2, 2, world)).toBe(true);
    expect(isWalkable(map, 5, 5, world)).toBe(false);

    world.removeEntity('b');
    expect(world.registry.getCollidersAtTile(5, 5)).toEqual([]);
    expect(isWalkable(map, 5, 5, world)).toBe(true);
  });

  it('re-runs the predicate on update: a mortal that loses the tag leaves the index', () => {
    const map = makeMap(8, 8);
    const world = new World(map);
    world.addEntity(npc('possessed', 2, 2, ['obstacle']));
    expect(world.registry.getCollidersAtTile(2, 2)).toHaveLength(1);

    world.registry.update('possessed', { tags: [] });
    expect(world.registry.getCollidersAtTile(2, 2)).toEqual([]);
    expect(isWalkable(map, 2, 2, world)).toBe(true);
  });

  it('a hard kind stays a CANDIDATE without the tag, but no longer blocks', () => {
    // The index is deliberately a superset of what blocks: only `tileHasObstacle`
    // / `tileBlockedByBuilding` decide solidity, so a de-tagged boulder is still
    // cheap to look at and correctly walkable.
    const map = makeMap(8, 8);
    const world = new World(map);
    world.addEntity(boulder('b', 2, 2));
    world.registry.update('b', { tags: [] });
    expect(isWalkable(map, 2, 2, world)).toBe(true);
  });

  it('honours an explicit footprintCells list (barrier-style colliders)', () => {
    const map = makeMap(8, 8);
    const world = new World(map);
    world.addEntity({
      id: 'wall', kind: 'wall_segment', x: 1, y: 1, tags: ['obstacle'],
      properties: { footprintCells: [[1, 1], [2, 1], [3, 1]] },
    } as unknown as Entity);

    for (const [x, y] of [[1, 1], [2, 1], [3, 1]]) {
      expect(world.registry.getCollidersAtTile(x, y).map((e) => e.id)).toEqual(['wall']);
      expect(isWalkable(map, x, y, world)).toBe(false);
    }
    expect(world.registry.getCollidersAtTile(4, 1)).toEqual([]);
  });
});
