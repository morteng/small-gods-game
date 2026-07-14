import { describe, it, expect } from 'vitest';
import { coastalBrush } from '@/world/brushes/coastal';
import { EMPTY_CONTEXT } from '@/world/brush-helpers';
import type { BrushContext, GameMap, Tile } from '@/core/types';

function ctx(rows: string[][]): BrushContext {
  const h = rows.length, w = rows[0].length;
  const tiles: Tile[][] = rows.map((row, y) => row.map((type, x) => ({ type, x, y, walkable: true, state: 'realized' as const })));
  const map: GameMap = { tiles, width: w, height: h, villages: [], seed: 0, success: true, worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] };
  return { ...EMPTY_CONTEXT, tiles: map };
}

describe('coastal brush', () => {
  it('is deterministic', () => {
    const c = ctx(Array.from({ length: 8 }, () => Array(8).fill('sand')));
    const r = { x: 0, y: 0, w: 8, h: 8 };
    expect(coastalBrush(r, 42, c)).toEqual(coastalBrush(r, 42, c));
  });

  it('produces a stable snapshot', () => {
    // Sand strip with shallow_water along the bottom row to exercise the reeds path
    const rows: string[][] = [];
    for (let y = 0; y < 8; y++) rows.push(Array(8).fill(y < 6 ? 'sand' : 'shallow_water'));
    const c = ctx(rows);
    expect(coastalBrush({ x: 0, y: 0, w: 8, h: 8 }, 42, c)).toMatchSnapshot();
  });

  it('emits zero on non-coastal tiles', () => {
    const c = ctx([['grass','grass'],['grass','grass']]);
    expect(coastalBrush({ x: 0, y: 0, w: 2, h: 2 }, 1, c)).toEqual([]);
  });

  it('only emits driftwood, shell, marram-grass, gorse', () => {
    const c = ctx(Array.from({ length: 16 }, () => Array(16).fill('sand')));
    const allowed = new Set(['driftwood', 'shell', 'marram-grass', 'gorse']);
    for (const e of coastalBrush({ x: 0, y: 0, w: 16, h: 16 }, 3, c)) {
      expect(allowed.has(e.kind)).toBe(true);
    }
  });

  it('MARRAM binds the foredune — the waterline grass only appears adjacent to water', () => {
    // Inland sand block, NO water anywhere → no dune grass.
    const dry = ctx(Array.from({ length: 8 }, () => Array(8).fill('sand')));
    expect(coastalBrush({ x: 0, y: 0, w: 8, h: 8 }, 9, dry).some(e => e.kind === 'marram-grass')).toBe(false);

    // A sand strip fronting water → marram appears, and only on the water-adjacent row.
    const rows: string[][] = [];
    for (let y = 0; y < 8; y++) rows.push(Array(8).fill(y < 6 ? 'sand' : 'shallow_water'));
    const out = coastalBrush({ x: 0, y: 0, w: 8, h: 8 }, 9, ctx(rows));
    const marram = out.filter(e => e.kind === 'marram-grass');
    expect(marram.length).toBeGreaterThan(0);
    expect(marram.every(e => Math.floor(e.y) === 5)).toBe(true);   // the row touching water
  });

  it('GORSE is demoted to the dune BACK-slope — never at the tideline', () => {
    const rows: string[][] = [];
    for (let y = 0; y < 12; y++) rows.push(Array(12).fill(y < 10 ? 'sand' : 'shallow_water'));
    const out = coastalBrush({ x: 0, y: 0, w: 12, h: 12 }, 4, ctx(rows));
    const gorse = out.filter(e => e.kind === 'gorse');
    expect(gorse.length).toBeGreaterThan(0);
    // Row 9 is the water-adjacent foredune: gorse must not sit there (marram does).
    expect(gorse.every(e => Math.floor(e.y) < 9)).toBe(true);
  });
});
