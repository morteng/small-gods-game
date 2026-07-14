import { describe, it, expect } from 'vitest';
import { pineForestBrush } from '@/world/brushes/pine-forest';
import { canopyOf, undergrowthOf } from '@/flora/biome-flora';
import { EMPTY_CONTEXT } from '@/world/brush-helpers';
import type { BrushContext, GameMap, Tile } from '@/core/types';

const CANOPY = new Set(canopyOf('pine_forest').map(([k]) => k));
const ALLOWED = new Set<string>([...CANOPY, ...undergrowthOf('pine_forest').map(([k]) => k)]);

function ctx(rows: string[][]): BrushContext {
  const h = rows.length, w = rows[0].length;
  const tiles: Tile[][] = rows.map((row, y) => row.map((type, x) => ({ type, x, y, walkable: true, state: 'realized' as const })));
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
    // 'dirt' — a tile NO sub-brush covers (these brushes deliberately grass-cover
    // 'grass'/'meadow'/'glen' tiles via placeGrassCover, so grass is not foreign).
    expect(pineForestBrush({ x: 0, y: 0, w: 2, h: 2 }, 1, ctx([['dirt','dirt'],['dirt','dirt']]))).toEqual([]);
  });
  it('only emits the pine pool species', () => {
    const c = allPine(16, 16);
    for (const e of pineForestBrush({ x: 0, y: 0, w: 16, h: 16 }, 3, c)) {
      expect(ALLOWED.has(e.kind)).toBe(true);
    }
  });
  it('produces ~40% tree density', () => {
    // Recomputed after the grass/bush density pass (density 0.32→0.40): canopy
    // count on a 20×20 all-pine_forest region ranged 148-203 across 8 seeds.
    const c = allPine(20, 20);
    const out = pineForestBrush({ x: 0, y: 0, w: 20, h: 20 }, 11, c);
    const trees = out.filter(e => CANOPY.has(e.kind));
    expect(trees.length).toBeGreaterThan(120);
    expect(trees.length).toBeLessThan(230);
  });
});
