// tests/unit/riparian-corridor-cull.test.ts
//
// Regression for a gap that shipped unnoticed: `WATER_PLACED_TAG` (riparian-scatter.ts)
// exempts riparian entities from the END-of-gen corridor sweep (`clearObstructedVegetation`
// in vegetation-clear.ts), but TWO OLDER cull passes run BEFORE it and never checked the
// tag — `prewarmAllSettlementWear` (settlement-wear.ts) and `clearKillingFields`
// (killing-field.ts). Both delete via the shared `cullVegetationEntities()`
// (settlement-wear.ts), which now skips `waterPlaced` entities the same way the corridor
// sweep does. This file asserts a river within WEAR_FALLOFF / KILL_FIELD_REACH of a
// settlement/wall no longer loses its riparian dressing to either pass, while an
// untagged twin (a control — proving the fixture actually exercises the cull) is still
// removed as before.

import { describe, it, expect } from 'vitest';
import type { GameMap, Tile, Entity } from '@/core/types';
import { World } from '@/world/world';
import { TrampleGrid } from '@/sim/trample';
import { prewarmAllSettlementWear } from '@/world/settlement-wear';
import { clearKillingFields } from '@/world/killing-field';
import { WATER_PLACED_TAG } from '@/world/riparian-scatter';
import type { SettlementPlan } from '@/world/settlement-plan';
import { BARRIER_DEFAULTS, type BarrierRun, type PlacedBarrier } from '@/world/barrier';

function grassMap(w: number, h: number): GameMap {
  const tiles: Tile[][] = [];
  for (let y = 0; y < h; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < w; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' } as Tile);
    tiles.push(row);
  }
  return { tiles, width: w, height: h, seed: 1, worldSeed: null } as unknown as GameMap;
}

/** A riparian boulder entity (flora-DB rock species, category `vegetation`). */
function boulder(id: string, x: number, y: number, waterPlaced: boolean): Entity {
  return {
    id, kind: 'granite-boulder', x, y,
    tags: waterPlaced ? [WATER_PLACED_TAG] : [],
    properties: {},
  } as unknown as Entity;
}

/** Rectangle ring path (closed), matching what worldgen commits for a wall run. */
function rect(minX: number, minY: number, maxX: number, maxY: number): [number, number][] {
  return [[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY], [minX, minY]];
}

describe('riparian entities survive the OLDER cull passes (prewarm + killing field)', () => {
  it('prewarmAllSettlementWear spares a waterPlaced bank boulder inside WEAR_FALLOFF, culls an untagged twin', () => {
    const map = grassMap(30, 30);
    // A short road run — WEAR_FALLOFF is 4, so a bank boulder 1 tile off the road sits
    // well inside the cull band.
    const plan = {
      poiId: 'poi1',
      edges: [{ a: 0, b: 1, kind: 'through', tiles: [{ x: 10, y: 10 }, { x: 11, y: 10 }] }],
      market: [],
      civics: [],
    } as unknown as SettlementPlan;

    const world = new World(map);
    world.addEntity(boulder('b_tagged', 12.5, 10.5, true));
    world.addEntity(boulder('b_control', 12.5, 10.5, false));

    const grid = new TrampleGrid(map.width, map.height);
    prewarmAllSettlementWear(grid, [plan], map, world, 1);

    expect(world.registry.has('b_tagged')).toBe(true);
    expect(world.registry.has('b_control')).toBe(false);
  });

  it('clearKillingFields spares a waterPlaced river boulder inside KILL_FIELD_REACH, culls an untagged twin', () => {
    const map = grassMap(64, 64);
    // A river crossing the killing-field band on the wall's north (open) leg.
    for (let x = 20; x < 44; x++) map.tiles[16][x] = { type: 'river', x, y: 16, walkable: false, state: 'realized' } as Tile;

    const run: BarrierRun = {
      kind: 'wall', path: rect(20, 20, 44, 44), ...BARRIER_DEFAULTS.wall,
      crenellated: true, material: 'stone', thickness: 1, centroid: [32, 32], gates: [],
    };
    map.barrierRuns = [{ id: 'w1', run }] as PlacedBarrier[];

    const world = new World(map);
    // KILL_FIELD_REACH is 6 (inner 1..outer 7) off the north leg at y=20 — y=16 is inside it.
    world.addEntity(boulder('b_tagged', 30.5, 16.5, true));
    world.addEntity(boulder('b_control', 30.5, 16.5, false));

    clearKillingFields(map, world);

    expect(world.registry.has('b_tagged')).toBe(true);
    expect(world.registry.has('b_control')).toBe(false);
  });
});
