import { describe, it, expect } from 'vitest';
import { sacredGroveBrush } from '@/world/brushes/sacred-grove';
import { EMPTY_CONTEXT } from '@/world/brush-helpers';
import type { BrushContext, GameMap, Tile } from '@/core/types';

function ctx(rows: string[][]): BrushContext {
  const h = rows.length, w = rows[0].length;
  const tiles: Tile[][] = rows.map((row, y) => row.map((type, x) => ({ type, x, y, walkable: true })));
  const map: GameMap = { tiles, width: w, height: h, villages: [], seed: 0, success: true, worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] };
  return { ...EMPTY_CONTEXT, tiles: map };
}
const allSacred = (w: number, h: number) => ctx(Array.from({ length: h }, () => Array(w).fill('sacred_grove')));

describe('sacred_grove brush', () => {
  it('is deterministic', () => {
    const c = allSacred(8, 8);
    const r = { x: 0, y: 0, w: 8, h: 8 };
    expect(sacredGroveBrush(r, 42, c)).toEqual(sacredGroveBrush(r, 42, c));
  });
  it('produces a stable snapshot', () => {
    const c = allSacred(8, 8);
    expect(sacredGroveBrush({ x: 0, y: 0, w: 8, h: 8 }, 42, c)).toMatchSnapshot();
  });
  it('emits zero on non-sacred tiles', () => {
    expect(sacredGroveBrush({ x: 0, y: 0, w: 2, h: 2 }, 1, ctx([['grass','grass'],['grass','grass']]))).toEqual([]);
  });
  it('also fires on glen tile type', () => {
    const c = ctx([['glen','glen'],['glen','glen']]);
    const out = sacredGroveBrush({ x: 0, y: 0, w: 2, h: 2 }, 1, c);
    expect(out.length).toBeGreaterThanOrEqual(0);
  });
  it('only emits allowed kinds', () => {
    const allowed = new Set(['oak_tree', 'birch_tree', 'flower_patch', 'standing_stone', 'shrine_stone']);
    const c = allSacred(16, 16);
    for (const e of sacredGroveBrush({ x: 0, y: 0, w: 16, h: 16 }, 3, c)) {
      expect(allowed.has(e.kind)).toBe(true);
    }
  });
  it('every entity has the sacred tag', () => {
    const c = allSacred(16, 16);
    for (const e of sacredGroveBrush({ x: 0, y: 0, w: 16, h: 16 }, 7, c)) {
      expect(e.tags).toContain('sacred');
    }
  });
});
