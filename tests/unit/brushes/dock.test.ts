import { describe, it, expect } from 'vitest';
import { dockBrush } from '@/world/brushes/dock';
import { EMPTY_CONTEXT } from '@/world/brush-helpers';
import type { BrushContext, GameMap, Tile } from '@/core/types';

function buildCtx(rows: string[][]): BrushContext {
  const h = rows.length, w = rows[0].length;
  const tiles: Tile[][] = rows.map((row, y) => row.map((type, x) => ({ type, x, y, walkable: true, state: 'realized' as const })));
  const map: GameMap = { tiles, width: w, height: h, villages: [], seed: 0, success: true, worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] };
  return { ...EMPTY_CONTEXT, tiles: map };
}

describe('dock brush', () => {
  it('is deterministic', () => {
    const c = buildCtx(Array.from({ length: 8 }, () => Array(8).fill('sand')));
    const r = { x: 0, y: 0, w: 8, h: 8 };
    expect(dockBrush(r, 42, c)).toEqual(dockBrush(r, 42, c));
  });

  it('produces a stable snapshot', () => {
    const rows: string[][] = [];
    for (let y = 0; y < 8; y++) rows.push(Array(8).fill(y < 6 ? 'sand' : 'shallow_water'));
    const c = buildCtx(rows);
    expect(dockBrush({ x: 0, y: 0, w: 8, h: 8 }, 42, c)).toMatchSnapshot();
  });

  it('emits zero on grass tiles', () => {
    const c = buildCtx([['grass','grass'],['grass','grass']]);
    expect(dockBrush({ x: 0, y: 0, w: 2, h: 2 }, 1, c)).toEqual([]);
  });

  it('only emits allowed kinds', () => {
    const rows: string[][] = [];
    for (let y = 0; y < 8; y++) rows.push(Array(8).fill(y < 6 ? 'sand' : 'shallow_water'));
    const c = buildCtx(rows);
    const allowed = new Set(['crate', 'rope_coil', 'barrel', 'nets', 'anchor']);
    for (const e of dockBrush({ x: 0, y: 0, w: 8, h: 8 }, 5, c)) {
      expect(allowed.has(e.kind)).toBe(true);
    }
  });

  it('nets only appear near water tiles', () => {
    // All-sand grid, no water → no nets
    const c = buildCtx(Array.from({ length: 8 }, () => Array(8).fill('sand')));
    const out = dockBrush({ x: 0, y: 0, w: 8, h: 8 }, 7, c);
    expect(out.some(e => e.kind === 'nets')).toBe(false);
  });

  it('emits a single anchor near region center', () => {
    const c = buildCtx(Array.from({ length: 10 }, () => Array(10).fill('sand')));
    const out = dockBrush({ x: 0, y: 0, w: 10, h: 10 }, 11, c);
    const anchors = out.filter(e => e.kind === 'anchor');
    expect(anchors.length).toBe(1);
    expect(Math.floor(anchors[0].x)).toBe(5);
    expect(Math.floor(anchors[0].y)).toBe(5);
  });
});
