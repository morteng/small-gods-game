import { describe, it, expect } from 'vitest';
import type { Tile, Entity } from '@/core/types';
import type { World } from '@/world/world';
import type { SettlementPlan } from '@/world/settlement-plan';
import { depositBuildingWear } from '@/world/settlement-wear';
import { TrampleGrid, TRAMPLE } from '@/sim/trample';

/** All-grass tile grid (soft, trample-eligible ground). */
function grass(w: number, h: number): Tile[][] {
  const rows: Tile[][] = [];
  for (let y = 0; y < h; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < w; x++) row.push({ type: 'grass', walkable: true } as unknown as Tile);
    rows.push(row);
  }
  return rows;
}

/** A placed structure entity with a south-facing main door. Origin at (ox,oy), footprint w×h. */
function building(id: string, kind: string, ox: number, oy: number, w: number, h: number, withDoor = true): Entity {
  const anchors = withDoor
    ? [{ kind: 'door', main: true, x: ox + Math.floor(w / 2) + 0.5, y: oy + h, facing: [0, 1] as [number, number] }]
    : [];
  return {
    id, kind, x: ox, y: oy, tags: ['building'],
    properties: { poiId: 'poi1', footprint: { w, h }, anchors },
  } as unknown as Entity;
}

function fakeWorld(entities: Entity[]): World {
  return { registry: { all: () => entities } } as unknown as World;
}

const plan = { poiId: 'poi1', civics: [] } as unknown as SettlementPlan;

describe('settlement-wear — building doorstep + perimeter deposits', () => {
  it('a BUSY building doorstep promotes (seeded over PROMOTE_HI); an ordinary one only primes', () => {
    const tiles = grass(40, 40);
    const grid = new TrampleGrid(40, 40);
    // Busy market at (10,10); ordinary cottage at (25,10). Doors face south → doorstep one tile below.
    const busy = building('b_market', 'market_stall', 10, 10, 3, 3);
    const cottage = building('b_cottage', 'cottage', 25, 10, 3, 3);
    depositBuildingWear(grid, plan, tiles, fakeWorld([busy, cottage]), new Set());

    const busyStep = grid.wearAt(11, 13);       // floor(11.5), floor(13.5)
    const cottageStep = grid.wearAt(26, 13);
    expect(busyStep).toBeGreaterThanOrEqual(TRAMPLE.PROMOTE_HI);   // will realise to dirt at settle
    expect(cottageStep).toBeGreaterThan(0);
    expect(cottageStep).toBeLessThan(TRAMPLE.PROMOTE_HI);          // primed, not promoted
  });

  it('settle() realises the busy doorstep to dirt, leaves the ordinary doorstep grass', () => {
    const tiles = grass(40, 40);
    const map = { tiles, width: 40, height: 40 } as unknown as import('@/core/types').GameMap;
    const grid = new TrampleGrid(40, 40);
    depositBuildingWear(grid, plan, tiles,
      fakeWorld([building('b_market', 'market_stall', 10, 10, 3, 3), building('b_cottage', 'cottage', 25, 10, 3, 3)]),
      new Set());
    grid.settle(map);
    expect(tiles[13][11].type).toBe('dirt');   // busy doorstep worn
    expect(tiles[13][26].type).toBe('grass');  // quiet doorstep untouched
  });

  it('a busy building lays a light PRIMED perimeter ring (not promoted at gen)', () => {
    const tiles = grass(40, 40);
    const grid = new TrampleGrid(40, 40);
    depositBuildingWear(grid, plan, tiles, fakeWorld([building('b_well', 'well', 10, 10, 2, 2, false)]), new Set());
    const ring = grid.wearAt(9, 10); // one tile left of the footprint
    expect(ring).toBeGreaterThan(0);
    expect(ring).toBeLessThan(TRAMPLE.PROMOTE_HI);
  });

  it('a structure with no door anchor is counted as a fallback and gets no doorstep', () => {
    const tiles = grass(40, 40);
    const grid = new TrampleGrid(40, 40);
    const stats = depositBuildingWear(grid, plan, tiles,
      fakeWorld([building('b_well', 'well', 10, 10, 1, 1, false)]), new Set());
    expect(stats.buildings).toBe(1);
    expect(stats.doorsteps).toBe(0);
    expect(stats.doorFallback).toBe(1);
    expect(stats.perimeter).toBe(1);   // still a busy premises → perimeter ring
  });

  it('skips tiles in the skip set (the tended green) and off-plan buildings', () => {
    const tiles = grass(40, 40);
    const grid = new TrampleGrid(40, 40);
    const skip = new Set<string>(['11,13']); // the busy doorstep tile is on the green
    const offPlan = building('b_other', 'market_stall', 30, 30, 3, 3);
    (offPlan.properties as { poiId?: string }).poiId = 'poi2';
    const stats = depositBuildingWear(grid, plan, tiles,
      fakeWorld([building('b_market', 'market_stall', 10, 10, 3, 3), offPlan]), skip);
    expect(grid.wearAt(11, 13)).toBe(0);   // doorstep on the green → no wear
    expect(stats.buildings).toBe(1);       // off-plan building ignored
  });

  it('is deterministic regardless of registry order (deposits commute + saturate)', () => {
    const tiles = grass(40, 40);
    const a = building('b_market', 'market_stall', 10, 10, 3, 3);
    const b = building('b_cottage', 'cottage', 25, 10, 3, 3);
    const g1 = new TrampleGrid(40, 40); depositBuildingWear(g1, plan, tiles, fakeWorld([a, b]), new Set());
    const g2 = new TrampleGrid(40, 40); depositBuildingWear(g2, plan, tiles, fakeWorld([b, a]), new Set());
    expect(g1.serialize().cells.sort()).toEqual(g2.serialize().cells.sort());
  });
});
