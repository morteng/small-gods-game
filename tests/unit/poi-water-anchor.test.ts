import { describe, it, expect } from 'vitest';
import { snapDrySettlementsOffWater, DRY_SETTLEMENT_POI } from '@/map/map-generator';
import { WaterType } from '@/core/types';
import type { POI, Tile } from '@/core/types';

// WCV 103, type-aware POI anchoring. A POI's tile is picked by `planWorldLayout` from
// the terrain SHAPE, before hydrology fills basins, so a DRY-settlement POI can land
// inside a lake the fill pass later stamps. `snapDrySettlementsOffWater` walks those
// (and only those) to the nearest dry shore; inherently-wet POIs stay put. It mutates
// `poi.position` IN PLACE (a fresh position object on the same POI) — deliberately, so
// `map.worldSeed === (the passed worldSeed)` identity holds; a multi-seed harness that
// shares one layout must clone it per seed (the connectome lint does).

const W = 20, H = 20;

/** A `waterType` grid with a square lake of `Lake` cells in [x0,x1)×[y0,y1). */
function lakeGrid(x0: number, x1: number, y0: number, y1: number): Uint8Array {
  const wt = new Uint8Array(W * H); // all Dry
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) wt[y * W + x] = WaterType.Lake;
  return wt;
}

/** Tiles matching a waterType grid: lake cells `water`+unwalkable, else walkable grass. */
function tilesFor(wt: Uint8Array): Tile[][] {
  const tiles: Tile[][] = [];
  for (let y = 0; y < H; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < W; x++) {
      const lake = wt[y * W + x] === WaterType.Lake;
      row.push({ type: lake ? 'water' : 'grass', x, y, walkable: !lake, state: 'realized' });
    }
    tiles.push(row);
  }
  return tiles;
}

function poi(id: string, type: string, x: number, y: number): POI {
  return { id, type, name: id, position: { x, y } } as POI;
}

describe('type-aware POI water anchoring (WCV 103)', () => {
  it('snaps a dry settlement out of a lake onto dry, unwalkable-free ground', () => {
    const wt = lakeGrid(5, 15, 5, 15); // 10×10 lake
    const tiles = tilesFor(wt);
    const village = poi('v', 'village', 10, 10); // dead centre of the lake
    snapDrySettlementsOffWater([village], W, H, wt, tiles);
    const { x, y } = village.position!;
    expect(wt[y * W + x]).toBe(WaterType.Dry);
    expect(tiles[y][x].walkable).toBe(true);
    // Nearest dry ring from (10,10) is Chebyshev distance 5 (the lake edge is [5,15)).
    expect(Math.max(Math.abs(x - 10), Math.abs(y - 10))).toBe(5);
  });

  it.each([...DRY_SETTLEMENT_POI])('snaps a %s off the water', (type) => {
    const wt = lakeGrid(5, 15, 5, 15);
    const tiles = tilesFor(wt);
    const p = poi('p', type, 10, 10);
    snapDrySettlementsOffWater([p], W, H, wt, tiles);
    expect(wt[p.position!.y * W + p.position!.x]).toBe(WaterType.Dry);
  });

  it('leaves inherently-wet POI types in the water (lake/swamp/ruins)', () => {
    const wt = lakeGrid(5, 15, 5, 15);
    const tiles = tilesFor(wt);
    for (const type of ['lake', 'swamp', 'ruins']) {
      const p = poi('w', type, 10, 10);
      snapDrySettlementsOffWater([p], W, H, wt, tiles);
      expect(p.position).toEqual({ x: 10, y: 10 }); // untouched
    }
  });

  it('leaves a dry settlement already on dry land untouched', () => {
    const wt = lakeGrid(5, 15, 5, 15);
    const tiles = tilesFor(wt);
    const p = poi('v', 'village', 2, 2);
    snapDrySettlementsOffWater([p], W, H, wt, tiles);
    expect(p.position).toEqual({ x: 2, y: 2 });
  });

  it('mutates poi.position IN PLACE (preserving worldSeed identity), with a fresh position object', () => {
    const wt = lakeGrid(5, 15, 5, 15);
    const tiles = tilesFor(wt);
    const p = poi('v', 'village', 10, 10);
    const beforePos = p.position!;                 // same object reference held here
    snapDrySettlementsOffWater([p], W, H, wt, tiles);
    // The POI object is the SAME (in-place mutation — no clone), but moved off the lake…
    expect(wt[p.position!.y * W + p.position!.x]).toBe(WaterType.Dry);
    // …via a FRESH position object (the old one, still held, is untouched at the lake centre).
    expect(p.position).not.toBe(beforePos);
    expect(beforePos).toEqual({ x: 10, y: 10 });
  });
});
