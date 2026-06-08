import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import { placeWallConnections } from '@/world/wall-connections';
import type { GameMap, Tile, WorldSeed } from '@/core/types';
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

describe('placeWallConnections', () => {
  const poiA = { id: 'keep', position: { x: 1, y: 1 } };
  const poiB = { id: 'gate', position: { x: 6, y: 1 } };

  it('turns a wall connection into a single wall-run barrier between the two POIs', () => {
    const { world } = makeWorld(8, 8);
    const seed = {
      pois: [poiA, poiB],
      connections: [{ from: 'keep', to: 'gate', type: 'wall' }],
    } as unknown as WorldSeed;

    const ids = placeWallConnections(world, seed);
    expect(ids).toHaveLength(1);

    const e = world.registry.get(ids[0])!;
    expect(e.kind).toBe('wall_run');
    const run = e.properties!.barrier as BarrierRun;
    expect(run.path[0]).toEqual([poiA.position.x, poiA.position.y]);
    expect(run.path[1]).toEqual([poiB.position.x, poiB.position.y]);
  });

  it('ignores non-wall connections (e.g. road)', () => {
    const { world } = makeWorld(8, 8);
    const seed = {
      pois: [poiA, poiB],
      connections: [{ from: 'keep', to: 'gate', type: 'road' }],
    } as unknown as WorldSeed;

    const ids = placeWallConnections(world, seed);
    expect(ids).toHaveLength(0);
  });

  it('skips wall connections whose endpoints lack positions', () => {
    const { world } = makeWorld(8, 8);
    const seed = {
      pois: [poiA, { id: 'ghost' }],
      connections: [{ from: 'keep', to: 'ghost', type: 'wall' }],
    } as unknown as WorldSeed;

    const ids = placeWallConnections(world, seed);
    expect(ids).toHaveLength(0);
  });
});
