import { describe, it, expect } from 'vitest';
import { castleBrush } from '@/world/brushes/castle';
import { EMPTY_CONTEXT } from '@/world/brush-helpers';
import { World } from '@/world/world';
import type { BrushContext, GameMap, Tile } from '@/core/types';

function buildCtx(rows: string[][]): BrushContext {
  const h = rows.length, w = rows[0].length;
  const tiles: Tile[][] = rows.map((row, y) => row.map((type, x) => ({ type, x, y, walkable: true, state: 'realized' as const })));
  const map: GameMap = { tiles, width: w, height: h, villages: [], seed: 0, success: true, worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] };
  return { ...EMPTY_CONTEXT, tiles: map };
}

function ctxWithBuilding(rows: string[][], bx: number, by: number): BrushContext {
  const base = buildCtx(rows);
  const world = new World(base.tiles);
  world.addEntity({ id: 'keep', kind: 'castle_keep', x: bx, y: by, tags: ['building'] });
  return { world: world.asReadOnly(), tiles: base.tiles };
}

const grass = (w: number, h: number) => Array.from({ length: h }, () => Array<string>(w).fill('grass'));

describe('castle brush', () => {
  it('is deterministic', () => {
    const c = buildCtx(grass(10, 10));
    const r = { x: 0, y: 0, w: 10, h: 10 };
    expect(castleBrush(r, 42, c)).toEqual(castleBrush(r, 42, c));
  });

  it('produces a stable snapshot', () => {
    const c = buildCtx(grass(10, 10));
    expect(castleBrush({ x: 0, y: 0, w: 10, h: 10 }, 42, c)).toMatchSnapshot();
  });

  it('emits up to 4 banners at region corners', () => {
    const c = buildCtx(grass(10, 10));
    const out = castleBrush({ x: 0, y: 0, w: 10, h: 10 }, 1, c);
    const banners = out.filter(e => e.kind === 'banner');
    expect(banners.length).toBeGreaterThan(0);
    expect(banners.length).toBeLessThanOrEqual(4);
    for (const b of banners) {
      const fx = Math.floor(b.x), fy = Math.floor(b.y);
      const onCorner = (fx === 0 || fx === 9) && (fy === 0 || fy === 9);
      expect(onCorner).toBe(true);
    }
  });

  it('skips banner on a corner occupied by a building', () => {
    const ctx = ctxWithBuilding(grass(10, 10), 0, 0);
    const out = castleBrush({ x: 0, y: 0, w: 10, h: 10 }, 1, ctx);
    expect(out.some(e => e.kind === 'banner' && Math.floor(e.x) === 0 && Math.floor(e.y) === 0)).toBe(false);
  });

  it('emits lamp_post on stone_road tiles', () => {
    const rows = grass(10, 10);
    for (let x = 0; x < 10; x++) rows[5][x] = 'stone_road';
    const c = buildCtx(rows);
    const out = castleBrush({ x: 0, y: 0, w: 10, h: 10 }, 3, c);
    const lamps = out.filter(e => e.kind === 'lamp_post');
    expect(lamps.length).toBeGreaterThan(0);
    for (const l of lamps) expect(Math.floor(l.y)).toBe(5);
  });

  it('only emits allowed kinds', () => {
    const rows = grass(10, 10);
    for (let x = 0; x < 10; x++) rows[5][x] = 'stone_road';
    const c = buildCtx(rows);
    const allowed = new Set(['banner', 'lamp_post']);
    for (const e of castleBrush({ x: 0, y: 0, w: 10, h: 10 }, 7, c)) {
      expect(allowed.has(e.kind)).toBe(true);
    }
  });
});
