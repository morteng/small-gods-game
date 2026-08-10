// WP-2: the ground-cover FILL sweep must treat a placed barrier run (wall/palisade/
// rampart/fence/barricade/hedge — tagged 'barrier', never 'building') as occupied,
// the same way it already treats a building footprint. Before this fix
// `fillBareGround` only checked `isBuilding`, so tufts got re-sown straight onto
// wall/tower cells right after the clearing pass removed the trees standing there.
import { describe, it, expect } from 'vitest';
import { fillBareGround } from '@/world/vegetation-fill';
import { World } from '@/world/world';
import { placeBarrier } from '@/world/place-barrier';
import { barrierFootprintTiles, gateOpeningCell } from '@/world/barrier';
import type { GameMap, Tile } from '@/core/types';
import type { BarrierRun } from '@/world/barrier';

function grassMap(w: number, h: number): GameMap {
  const tiles: Tile[][] = [];
  for (let y = 0; y < h; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < w; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
    tiles.push(row);
  }
  return {
    tiles, width: w, height: h, villages: [], seed: 1, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [],
    flatHeight: true, // dead-flat: no slope/altitude gates, isolates the occupancy check
  };
}

/** Every 'grassfill'-brush entity currently indexed at (x, y). */
function fillEntitiesAt(world: World, x: number, y: number) {
  return world.registry.getAtTile(x, y).filter((e) => e.id.startsWith('grassfill-'));
}

describe('fillBareGround — barriers (WP-2)', () => {
  it('never sows a tuft onto a wall run\'s blocking cell', () => {
    const map = grassMap(20, 20);
    const world = new World(map);
    const wall: BarrierRun = {
      kind: 'wall', path: [[2, 10], [17, 10]], height: 3, thickness: 1, material: 'stone',
      gates: [],
    };
    placeBarrier(world, wall);
    const { blocking } = barrierFootprintTiles(wall);

    // A generous seed sweep: the fill roll is a position/seed hash, so trying
    // several seeds makes this a real test of the occupancy gate rather than a
    // fluke of one seed's dice roll never landing on a wall cell anyway.
    for (let seed = 0; seed < 25; seed++) {
      fillBareGround(world, map, seed);
    }

    for (const [bx, by] of blocking) {
      expect(fillEntitiesAt(world, bx, by)).toHaveLength(0);
    }
  });

  it('still sows ground cover in a gate opening — opening cells are not in the blocking set', () => {
    // A wide gate (width 8) so the opening sits well clear of the nearest
    // remaining blocking cell — this test is about the OCCUPANCY check, not
    // vegetation-clear's separate canopy radius.
    const gate = { t: 7, width: 8 };
    const wall: BarrierRun = {
      kind: 'wall', path: [[2, 10], [17, 10]], height: 3, thickness: 1, material: 'stone',
      gates: [gate],
    };
    const [gx, gy] = gateOpeningCell(wall, gate);

    // Find a seed where an otherwise-identical bare-ground map (no barrier at all)
    // would plant a tuft at the opening cell, then confirm the walled map plants
    // it too — proving the gate cell is not wrongly excluded as "on the wall".
    let seed = -1;
    for (let candidate = 0; candidate < 200; candidate++) {
      const controlMap = grassMap(20, 20);
      const controlWorld = new World(controlMap);
      fillBareGround(controlWorld, controlMap, candidate);
      if (fillEntitiesAt(controlWorld, gx, gy).length > 0) { seed = candidate; break; }
    }
    expect(seed).toBeGreaterThanOrEqual(0); // sanity: the search itself must succeed

    const wallMap = grassMap(20, 20);
    const wallWorld = new World(wallMap);
    placeBarrier(wallWorld, wall);
    fillBareGround(wallWorld, wallMap, seed);

    expect(fillEntitiesAt(wallWorld, gx, gy).length).toBeGreaterThan(0);
  });

  it('leaves an existing building\'s footprint occupied as before (no regression)', () => {
    const map = grassMap(10, 10);
    const world = new World(map);
    world.addEntity({
      id: 'c', kind: 'cottage', x: 3, y: 3, tags: ['building'],
      properties: { category: 'building', footprint: { w: 2, h: 2 } },
    });

    for (let seed = 0; seed < 25; seed++) fillBareGround(world, map, seed);

    for (const [dx, dy] of [[3, 3], [4, 3], [3, 4], [4, 4]]) {
      expect(fillEntitiesAt(world, dx, dy)).toHaveLength(0);
    }
  });
});
