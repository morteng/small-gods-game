import { describe, it, expect } from 'vitest';
import { quarryBrush } from '@/world/brushes/quarry';
import { EMPTY_CONTEXT } from '@/world/brush-helpers';
import type { BrushContext, GameMap, Tile } from '@/core/types';

function ctx(rows: string[][]): BrushContext {
  const h = rows.length, w = rows[0].length;
  const tiles: Tile[][] = rows.map((row, y) => row.map((type, x) => ({ type, x, y, walkable: true, state: 'realized' as const })));
  const map: GameMap = { tiles, width: w, height: h, villages: [], seed: 0, success: true, worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] };
  return { ...EMPTY_CONTEXT, tiles: map };
}
const allQuarry = (w: number, h: number) => ctx(Array.from({ length: h }, () => Array(w).fill('quarry')));

describe('quarry brush', () => {
  it('is deterministic', () => {
    const c = allQuarry(8, 8);
    const r = { x: 0, y: 0, w: 8, h: 8 };
    expect(quarryBrush(r, 42, c)).toEqual(quarryBrush(r, 42, c));
  });
  it('produces a stable snapshot', () => {
    const c = allQuarry(8, 8);
    expect(quarryBrush({ x: 0, y: 0, w: 8, h: 8 }, 42, c)).toMatchSnapshot();
  });
  it('emits zero on non-quarry tiles', () => {
    expect(quarryBrush({ x: 0, y: 0, w: 2, h: 2 }, 1, ctx([['grass','grass'],['grass','grass']]))).toEqual([]);
  });
  it('only emits allowed kinds', () => {
    const allowed = new Set(['stone_block', 'boulder', 'ore_vein', 'pebbles']);
    const c = allQuarry(16, 16);
    for (const e of quarryBrush({ x: 0, y: 0, w: 16, h: 16 }, 3, c)) {
      expect(allowed.has(e.kind)).toBe(true);
    }
  });
});
