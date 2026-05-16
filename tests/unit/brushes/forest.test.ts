import { describe, it, expect } from 'vitest';
import { forestBrush } from '@/world/brushes/forest';
import { EMPTY_CONTEXT } from '@/world/brush-helpers';
import type { BrushContext, GameMap, Tile } from '@/core/types';

function ctx(rows: string[][]): BrushContext {
  const h = rows.length, w = rows[0].length;
  const tiles: Tile[][] = rows.map((row, y) => row.map((type, x) => ({ type, x, y, walkable: true })));
  const map: GameMap = {
    tiles, width: w, height: h, villages: [], seed: 0,
    success: true, worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [],
  };
  return { ...EMPTY_CONTEXT, tiles: map };
}

const allForest = (w: number, h: number) =>
  ctx(Array.from({ length: h }, () => Array(w).fill('forest')));

describe('forest brush', () => {
  it('is deterministic — same seed, same input → equal output', () => {
    const c = allForest(8, 8);
    const r = { x: 0, y: 0, w: 8, h: 8 };
    expect(forestBrush(r, 42, c)).toEqual(forestBrush(r, 42, c));
  });

  it('produces a stable snapshot', () => {
    const c = allForest(8, 8);
    expect(forestBrush({ x: 0, y: 0, w: 8, h: 8 }, 42, c)).toMatchSnapshot();
  });

  it('emits zero entities on non-forest tiles', () => {
    const c = ctx([['grass', 'grass'], ['grass', 'grass']]);
    expect(forestBrush({ x: 0, y: 0, w: 2, h: 2 }, 1, c)).toEqual([]);
  });

  it('emits only oak/orange/pale tree kinds', () => {
    const c = allForest(16, 16);
    const out = forestBrush({ x: 0, y: 0, w: 16, h: 16 }, 7, c);
    const allowed = new Set(['oak_tree', 'orange_tree', 'pale_tree']);
    for (const e of out) expect(allowed.has(e.kind)).toBe(true);
  });

  it('all emitted entities are inside the region (with sub-tile jitter tolerance)', () => {
    const c = allForest(16, 16);
    const r = { x: 4, y: 4, w: 8, h: 8 };
    for (const e of forestBrush(r, 1, c)) {
      // Tile coordinate (floor) must be inside region. Sub-tile jitter can push
      // floating x/y slightly outside, but the floor must still be in-region.
      const fx = Math.floor(e.x), fy = Math.floor(e.y);
      expect(fx).toBeGreaterThanOrEqual(r.x);
      expect(fx).toBeLessThan(r.x + r.w);
      expect(fy).toBeGreaterThanOrEqual(r.y);
      expect(fy).toBeLessThan(r.y + r.h);
    }
  });

  it('density ~0.35 on full-forest region produces ~30% density', () => {
    const c = allForest(20, 20);
    const out = forestBrush({ x: 0, y: 0, w: 20, h: 20 }, 13, c);
    expect(out.length).toBeGreaterThan(80);
    expect(out.length).toBeLessThan(200);
  });

  it('different seeds produce different output', () => {
    const c = allForest(16, 16);
    const r = { x: 0, y: 0, w: 16, h: 16 };
    const a = forestBrush(r, 1, c);
    const b = forestBrush(r, 999, c);
    expect(a).not.toEqual(b);
  });
});
