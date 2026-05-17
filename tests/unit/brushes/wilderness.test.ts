import { describe, it, expect } from 'vitest';
import { wildernessBrush } from '@/world/brushes/wilderness';
import { EMPTY_CONTEXT } from '@/world/brush-helpers';
import type { BrushContext, GameMap, Tile } from '@/core/types';

function buildCtx(rows: string[][]): BrushContext {
  const h = rows.length,
    w = rows[0].length;
  const tiles: Tile[][] = rows.map((row, y) =>
    row.map((type, x) => ({ type, x, y, walkable: true, state: 'realized' as const })),
  );
  const map: GameMap = {
    tiles,
    width: w,
    height: h,
    villages: [],
    seed: 0,
    success: true,
    worldSeed: null,
    stats: { iterations: 0, backtracks: 0 },
    buildings: [],
  };
  return { ...EMPTY_CONTEXT, tiles: map };
}
const grass = (w: number, h: number) =>
  buildCtx(Array.from({ length: h }, () => Array<string>(w).fill('grass')));

describe('wilderness brush', () => {
  it('is deterministic', () => {
    const c = grass(8, 8);
    const r = { x: 0, y: 0, w: 8, h: 8 };
    expect(wildernessBrush(r, 42, c)).toEqual(wildernessBrush(r, 42, c));
  });

  it('produces a stable snapshot', () => {
    const c = grass(8, 8);
    expect(wildernessBrush({ x: 0, y: 0, w: 8, h: 8 }, 42, c)).toMatchSnapshot();
  });

  it('emits zero on water tiles', () => {
    const c = buildCtx([
      ['deep_water', 'deep_water'],
      ['deep_water', 'deep_water'],
    ]);
    expect(wildernessBrush({ x: 0, y: 0, w: 2, h: 2 }, 1, c)).toEqual([]);
  });

  it('emits zero on stone_road tiles', () => {
    const c = buildCtx([
      ['stone_road', 'stone_road'],
      ['stone_road', 'stone_road'],
    ]);
    expect(wildernessBrush({ x: 0, y: 0, w: 2, h: 2 }, 1, c)).toEqual([]);
  });

  it('only emits allowed kinds', () => {
    const c = grass(20, 20);
    const allowed = new Set(['tent', 'campfire', 'log', 'stump']);
    for (const e of wildernessBrush({ x: 0, y: 0, w: 20, h: 20 }, 7, c)) {
      expect(allowed.has(e.kind)).toBe(true);
    }
  });

  it('low density — < 5% of tiles on a 30×30 grid', () => {
    const c = grass(30, 30); // 900 tiles
    const out = wildernessBrush({ x: 0, y: 0, w: 30, h: 30 }, 1, c);
    expect(out.length).toBeLessThan(50);
  });
});
