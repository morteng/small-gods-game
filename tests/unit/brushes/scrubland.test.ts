import { describe, it, expect } from 'vitest';
import { scrublandBrush } from '@/world/brushes/scrubland';
import { EMPTY_CONTEXT } from '@/world/brush-helpers';
import type { BrushContext, GameMap, Tile } from '@/core/types';

function ctx(rows: string[][]): BrushContext {
  const h = rows.length, w = rows[0].length;
  const tiles: Tile[][] = rows.map((row, y) => row.map((type, x) => ({ type, x, y, walkable: true, state: 'realized' as const })));
  const map: GameMap = { tiles, width: w, height: h, villages: [], seed: 0, success: true, worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] };
  return { ...EMPTY_CONTEXT, tiles: map };
}
const allScrub = (w: number, h: number) => ctx(Array.from({ length: h }, () => Array(w).fill('scrubland')));

describe('scrubland brush', () => {
  it('is deterministic', () => {
    const c = allScrub(8, 8);
    const r = { x: 0, y: 0, w: 8, h: 8 };
    expect(scrublandBrush(r, 42, c)).toEqual(scrublandBrush(r, 42, c));
  });
  it('produces a stable snapshot', () => {
    const c = allScrub(8, 8);
    expect(scrublandBrush({ x: 0, y: 0, w: 8, h: 8 }, 42, c)).toMatchSnapshot();
  });
  it('emits zero on non-scrubland tiles', () => {
    expect(scrublandBrush({ x: 0, y: 0, w: 2, h: 2 }, 1, ctx([['grass','grass'],['grass','grass']]))).toEqual([]);
  });
  it('only emits allowed kinds', () => {
    const allowed = new Set(['shrub', 'cactus', 'grass_tuft', 'boulder']);
    const c = allScrub(16, 16);
    for (const e of scrublandBrush({ x: 0, y: 0, w: 16, h: 16 }, 3, c)) {
      expect(allowed.has(e.kind)).toBe(true);
    }
  });
  it('produces ~20% vegetation density', () => {
    const c = allScrub(20, 20);
    const out = scrublandBrush({ x: 0, y: 0, w: 20, h: 20 }, 11, c);
    const veg = out.filter(e => e.kind === 'shrub' || e.kind === 'cactus' || e.kind === 'grass_tuft');
    expect(veg.length).toBeGreaterThan(40);
    expect(veg.length).toBeLessThan(120);
  });
});
