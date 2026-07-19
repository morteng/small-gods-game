import { describe, it, expect } from 'vitest';
import { hillsBrush } from '@/world/brushes/hills';
import { EMPTY_CONTEXT } from '@/world/brush-helpers';
import type { BrushContext, GameMap, Tile } from '@/core/types';

function ctx(rows: string[][]): BrushContext {
  const h = rows.length, w = rows[0].length;
  const tiles: Tile[][] = rows.map((row, y) => row.map((type, x) => ({ type, x, y, walkable: true, state: 'realized' as const })));
  const map: GameMap = { tiles, width: w, height: h, villages: [], seed: 0, success: true, worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [], flatHeight: true };
  return { ...EMPTY_CONTEXT, tiles: map };
}
const allHills = (w: number, h: number) => ctx(Array.from({ length: h }, () => Array(w).fill('hills')));

describe('hills brush', () => {
  it('is deterministic', () => {
    const c = allHills(8, 8);
    const r = { x: 0, y: 0, w: 8, h: 8 };
    expect(hillsBrush(r, 42, c)).toEqual(hillsBrush(r, 42, c));
  });
  it('produces a stable snapshot', () => {
    const c = allHills(8, 8);
    expect(hillsBrush({ x: 0, y: 0, w: 8, h: 8 }, 42, c)).toMatchSnapshot();
  });
  it('emits zero on non-hills tiles', () => {
    // The alpine brush covers hills/mountain/peak/rocky ONLY — it no longer drapes the
    // temperate grassland pool over its grass tiles (upland grass is tussock, not meadow).
    expect(hillsBrush({ x: 0, y: 0, w: 2, h: 2 }, 1, ctx([['dirt','dirt'],['dirt','dirt']]))).toEqual([]);
    expect(hillsBrush({ x: 0, y: 0, w: 2, h: 2 }, 1, ctx([['grass','grass'],['grass','grass']]))).toEqual([]);
  });
  it('also fires on mountain tile type', () => {
    const c = ctx(Array.from({ length: 8 }, () => Array(8).fill('mountain')));
    const out = hillsBrush({ x: 0, y: 0, w: 8, h: 8 }, 11, c);
    expect(out.length).toBeGreaterThan(0);
  });
  it('only emits allowed kinds — the alpine rock vocabulary + tussock + hardy dwarf shrubs', () => {
    const allowed = new Set(['tussock-grass', 'rock_pile', 'boulder', 'pebbles',
      'standing_stone', 'heather', 'common-juniper', 'gorse']);
    const c = allHills(16, 16);
    for (const e of hillsBrush({ x: 0, y: 0, w: 16, h: 16 }, 3, c)) {
      expect(allowed.has(e.kind)).toBe(true);
    }
  });
});
