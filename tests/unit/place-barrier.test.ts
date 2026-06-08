import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import { placeBarrier } from '@/world/place-barrier';
import { findPath } from '@/sim/pathfinding';
import type { GameMap, Tile } from '@/core/types';
import type { BarrierRun } from '@/world/barrier';

/** Build a small all-walkable, all-realized grass map + a World over it. */
function makeWorld(w: number, h: number): { world: World; map: GameMap } {
  const tiles: Tile[][] = [];
  for (let y = 0; y < h; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < w; x++) {
      row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
    }
    tiles.push(row);
  }
  const map: GameMap = {
    tiles, width: w, height: h, villages: [], seed: 1, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [],
  } as unknown as GameMap;
  const world = new World(map);
  return { world, map };
}

describe('placeBarrier', () => {
  it('creates an obstacle entity that blocks its cells but leaves the gate walkable', () => {
    const { world, map } = makeWorld(7, 7);
    const run: BarrierRun = {
      kind: 'wall', path: [[0, 3], [6, 3]], height: 3, thickness: 1, material: 'stone',
      gates: [{ t: 3, width: 1 }],
    };
    const id = placeBarrier(world, run);
    const e = world.registry.get(id)!;
    expect(e.kind).toBe('wall_run');
    expect(e.tags).toContain('obstacle');
    // a blocking cell along the wall is indexed under the entity id
    expect(world.registry.getAtTile(1, 3).some(x => x.id === id)).toBe(true);
    // the gate gap is NOT indexed (passable)
    expect(world.registry.getAtTile(3, 3).some(x => x.id === id)).toBe(false);
    // A* routes vertically THROUGH the gate at x=3
    expect(findPath(map, 3, 0, 3, 6, world)).not.toBeNull();
  });

  it('a gateless wall spanning the full width blocks all crossing paths', () => {
    const { world, map } = makeWorld(7, 7);
    const run: BarrierRun = {
      kind: 'wall', path: [[0, 3], [6, 3]], height: 3, thickness: 1, material: 'stone',
      gates: [],
    };
    placeBarrier(world, run);
    expect(findPath(map, 3, 0, 3, 6, world)).toBeNull();
  });
});
