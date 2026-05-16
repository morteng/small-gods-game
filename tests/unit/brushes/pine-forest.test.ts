import { describe, it, expect } from 'vitest';
import { pineForestBrush } from '@/world/brushes/pine-forest';
import { EMPTY_CONTEXT } from '@/world/brush-helpers';
import type { BrushContext, GameMap, Tile } from '@/core/types';

function ctx(rows: string[][]): BrushContext {
  const h = rows.length, w = rows[0].length;
  const tiles: Tile[][] = rows.map((row, y) => row.map((type, x) => ({ type, x, y, walkable: true })));
  const map: GameMap = { tiles, width: w, height: h, villages: [], seed: 0, success: true, worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] };
  return { ...EMPTY_CONTEXT, tiles: map };
}
const allPine = (w: number, h: number) => ctx(Array.from({ length: h }, () => Array(w).fill('pine_forest')));

describe('pine_forest brush', () => {
  it('is deterministic', () => {
    const c = allPine(8, 8);
    const r = { x: 0, y: 0, w: 8, h: 8 };
    expect(pineForestBrush(r, 42, c)).toEqual(pineForestBrush(r, 42, c));
  });
  it('produces a stable snapshot', () => {
    const c = allPine(8, 8);
    expect(pineForestBrush({ x: 0, y: 0, w: 8, h: 8 }, 42, c)).toMatchSnapshot();
  });
  it('emits zero on non-pine_forest', () => {
    expect(pineForestBrush({ x: 0, y: 0, w: 2, h: 2 }, 1, ctx([['grass','grass'],['grass','grass']]))).toEqual([]);
  });
  it('only emits pine_tree, pale_tree, mushroom', () => {
    const allowed = new Set(['pine_tree', 'pale_tree', 'mushroom']);
    const c = allPine(16, 16);
    for (const e of pineForestBrush({ x: 0, y: 0, w: 16, h: 16 }, 3, c)) {
      expect(allowed.has(e.kind)).toBe(true);
    }
  });
  it('produces ~50% tree density', () => {
    const c = allPine(20, 20);
    const out = pineForestBrush({ x: 0, y: 0, w: 20, h: 20 }, 11, c);
    const trees = out.filter(e => e.kind === 'pine_tree' || e.kind === 'pale_tree');
    expect(trees.length).toBeGreaterThan(140);
    expect(trees.length).toBeLessThan(260);
  });
});
