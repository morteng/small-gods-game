import { describe, it, expect } from 'vitest';
import { denseForestBrush } from '@/world/brushes/dense-forest';
import { EMPTY_CONTEXT } from '@/world/brush-helpers';
import type { BrushContext, GameMap, Tile } from '@/core/types';

function ctx(rows: string[][]): BrushContext {
  const h = rows.length, w = rows[0].length;
  const tiles: Tile[][] = rows.map((row, y) => row.map((type, x) => ({ type, x, y, walkable: true, state: 'realized' as const })));
  const map: GameMap = {
    tiles, width: w, height: h, villages: [], seed: 0,
    success: true, worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [],
  };
  return { ...EMPTY_CONTEXT, tiles: map };
}

const allDense = (w: number, h: number) =>
  ctx(Array.from({ length: h }, () => Array(w).fill('dense_forest')));

describe('dense_forest brush', () => {
  it('is deterministic', () => {
    const c = allDense(8, 8);
    const r = { x: 0, y: 0, w: 8, h: 8 };
    expect(denseForestBrush(r, 42, c)).toEqual(denseForestBrush(r, 42, c));
  });

  it('produces a stable snapshot', () => {
    const c = allDense(8, 8);
    expect(denseForestBrush({ x: 0, y: 0, w: 8, h: 8 }, 42, c)).toMatchSnapshot();
  });

  it('emits zero entities on non-dense_forest tiles', () => {
    const c = ctx([['grass', 'grass'], ['grass', 'grass']]);
    expect(denseForestBrush({ x: 0, y: 0, w: 2, h: 2 }, 1, c)).toEqual([]);
  });

  it('emits trees AND undergrowth on full dense_forest', () => {
    const c = allDense(20, 20);
    const out = denseForestBrush({ x: 0, y: 0, w: 20, h: 20 }, 7, c);
    const kinds = new Set(out.map(e => e.kind));
    expect(kinds.has('oak_tree') || kinds.has('brown_tree')).toBe(true);
    expect(kinds.has('shrub') || kinds.has('fern')).toBe(true);
  });

  it('only emits the allowed kinds', () => {
    const c = allDense(16, 16);
    const allowed = new Set(['oak_tree', 'brown_tree', 'shrub', 'fern']);
    for (const e of denseForestBrush({ x: 0, y: 0, w: 16, h: 16 }, 3, c)) {
      expect(allowed.has(e.kind)).toBe(true);
    }
  });

  it('tree density ~0.70 produces ~60-70% tile coverage', () => {
    const c = allDense(20, 20);  // 400 tiles
    const out = denseForestBrush({ x: 0, y: 0, w: 20, h: 20 }, 11, c);
    const trees = out.filter(e => e.kind === 'oak_tree' || e.kind === 'brown_tree');
    expect(trees.length).toBeGreaterThan(200);
    expect(trees.length).toBeLessThan(360);
  });
});
