import { describe, it, expect } from 'vitest';
import { walkRoad } from '@/terrain/road-walker';
import type { Tile, TerrainField } from '@/core/types';

function makeTiles(w: number, h: number, fill: string = 'grass'): Tile[][] {
  const rows: Tile[][] = [];
  for (let y = 0; y < h; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < w; x++) {
      row.push({ type: fill, x, y, walkable: true });
    }
    rows.push(row);
  }
  return rows;
}

function flatField(w: number, h: number, elev = 0.5): TerrainField {
  return {
    elevation:   new Float32Array(w * h).fill(elev),
    moisture:    new Float32Array(w * h),
    temperature: new Float32Array(w * h),
  };
}

describe('walkRoad', () => {
  it('produces a contiguous path from start to goal on flat terrain', () => {
    const tiles = makeTiles(10, 1);
    const fields = flatField(10, 1);
    const result = walkRoad({ x: 0, y: 0 }, { x: 9, y: 0 }, tiles, fields);

    expect(result.cells.length).toBeGreaterThan(0);
    expect(result.cells[0]).toEqual({ x: 0, y: 0 });
    expect(result.cells[result.cells.length - 1]).toEqual({ x: 9, y: 0 });

    // 4-connectedness
    for (let i = 1; i < result.cells.length; i++) {
      const a = result.cells[i - 1], b = result.cells[i];
      const md = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
      expect(md).toBe(1);
    }
  });

  it('returns empty cells array when no path exists (all water + autoBridge=false)', () => {
    const tiles = makeTiles(5, 1);
    const fields = flatField(5, 1);
    for (const row of tiles) for (const t of row) t.type = 'deep_water';
    const result = walkRoad({ x: 0, y: 0 }, { x: 4, y: 0 }, tiles, fields, {
      autoBridge: false,
    });
    expect(result.cells).toEqual([]);
  });

  it('prefers a longer flat path over a shorter steep one', () => {
    // 5×3 grid. Row 0 is very high; the walker should refuse to climb.
    const tiles = makeTiles(5, 3);
    const fields = flatField(5, 3, 0.5);
    for (let x = 0; x < 5; x++) fields.elevation[x] = 0.9;
    const result = walkRoad({ x: 0, y: 1 }, { x: 4, y: 1 }, tiles, fields, {
      slopeFactor: 100,
    });
    expect(result.cells.every(c => c.y !== 0)).toBe(true);
  });

  it('flags bridge cells when autoBridge=true and the path crosses water', () => {
    // 5×1 grid: land - water - water - land - land
    const tiles = makeTiles(5, 1);
    tiles[0][1].type = 'shallow_water';
    tiles[0][2].type = 'shallow_water';
    const fields = flatField(5, 1, 0.5);
    fields.elevation[1] = 0.3;
    fields.elevation[2] = 0.3;
    const result = walkRoad({ x: 0, y: 0 }, { x: 4, y: 0 }, tiles, fields, {
      autoBridge: true,
    });
    expect(result.cells.length).toBeGreaterThan(0);
    expect(result.bridgeCells.has(1)).toBe(true);
    expect(result.bridgeCells.has(2)).toBe(true);
  });
});
