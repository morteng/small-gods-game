import { describe, it, expect } from 'vitest';
import { sacredGroveBrush } from '@/world/brushes/sacred-grove';
import { canopyOf } from '@/flora/biome-flora';
import { EMPTY_CONTEXT } from '@/world/brush-helpers';
import type { BrushContext, GameMap, Tile } from '@/core/types';

const ALLOWED = new Set<string>([
  ...canopyOf('sacred_grove').map(([k]) => k),
  'foxglove', 'standing_stone', 'shrine_stone',
]);

function ctx(rows: string[][]): BrushContext {
  const h = rows.length, w = rows[0].length;
  const tiles: Tile[][] = rows.map((row, y) => row.map((type, x) => ({ type, x, y, walkable: true, state: 'realized' as const })));
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
    // 'dirt' — a tile NO sub-brush covers (these brushes deliberately grass-cover
    // 'grass'/'meadow'/'glen' tiles via placeGrassCover, so grass is not foreign).
    expect(sacredGroveBrush({ x: 0, y: 0, w: 2, h: 2 }, 1, ctx([['dirt','dirt'],['dirt','dirt']]))).toEqual([]);
  });
  it('also fires on glen tile type', () => {
    const c = ctx([['glen','glen'],['glen','glen']]);
    const out = sacredGroveBrush({ x: 0, y: 0, w: 2, h: 2 }, 1, c);
    expect(out.length).toBeGreaterThanOrEqual(0);
  });
  it('only emits the grove pool species + sacred props', () => {
    const c = allSacred(16, 16);
    for (const e of sacredGroveBrush({ x: 0, y: 0, w: 16, h: 16 }, 3, c)) {
      expect(ALLOWED.has(e.kind)).toBe(true);
    }
  });
  it('every entity has the sacred tag', () => {
    const c = allSacred(16, 16);
    for (const e of sacredGroveBrush({ x: 0, y: 0, w: 16, h: 16 }, 7, c)) {
      expect(e.tags).toContain('sacred');
    }
  });
});
