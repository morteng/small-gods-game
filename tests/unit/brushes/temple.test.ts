import { describe, it, expect } from 'vitest';
import { templeBrush } from '@/world/brushes/temple';
import { EMPTY_CONTEXT } from '@/world/brush-helpers';
import { World } from '@/world/world';
import type { BrushContext, GameMap, Tile } from '@/core/types';

function buildCtx(rows: string[][]): BrushContext {
  const h = rows.length, w = rows[0].length;
  const tiles: Tile[][] = rows.map((row, y) => row.map((type, x) => ({ type, x, y, walkable: true })));
  const map: GameMap = { tiles, width: w, height: h, villages: [], seed: 0, success: true, worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] };
  return { ...EMPTY_CONTEXT, tiles: map };
}

function buildCtxWithWorld(rows: string[][], buildings: Array<{ id: string; x: number; y: number }>): BrushContext {
  const base = buildCtx(rows);
  const world = new World(base.tiles);
  for (const b of buildings) world.addEntity({ id: b.id, kind: 'temple_small', x: b.x, y: b.y, tags: ['building'] });
  return { world: world.asReadOnly(), tiles: base.tiles };
}

const grass = (w: number, h: number) => Array.from({ length: h }, () => Array<string>(w).fill('grass'));

describe('temple brush', () => {
  it('is deterministic', () => {
    const c = buildCtx(grass(10, 10));
    const r = { x: 0, y: 0, w: 10, h: 10 };
    expect(templeBrush(r, 42, c)).toEqual(templeBrush(r, 42, c));
  });

  it('produces a stable snapshot', () => {
    const c = buildCtx(grass(10, 10));
    expect(templeBrush({ x: 0, y: 0, w: 10, h: 10 }, 42, c)).toMatchSnapshot();
  });

  it('emits altar at center', () => {
    const c = buildCtx(grass(10, 10));
    const out = templeBrush({ x: 0, y: 0, w: 10, h: 10 }, 1, c);
    const altars = out.filter(e => e.kind === 'altar');
    expect(altars.length).toBe(1);
    expect(Math.floor(altars[0].x)).toBe(5);
    expect(Math.floor(altars[0].y)).toBe(5);
  });

  it('emits up to 4 statues around the center', () => {
    const c = buildCtx(grass(10, 10));
    const out = templeBrush({ x: 0, y: 0, w: 10, h: 10 }, 1, c);
    const statues = out.filter(e => e.kind === 'statue');
    expect(statues.length).toBeGreaterThan(0);
    expect(statues.length).toBeLessThanOrEqual(4);
  });

  it('skips altar if center has a building', () => {
    const ctx = buildCtxWithWorld(grass(10, 10), [{ id: 'temple-here', x: 5, y: 5 }]);
    const out = templeBrush({ x: 0, y: 0, w: 10, h: 10 }, 1, ctx);
    expect(out.some(e => e.kind === 'altar')).toBe(false);
  });

  it('only emits allowed kinds', () => {
    const c = buildCtx(grass(10, 10));
    const allowed = new Set(['altar', 'statue', 'flower_patch']);
    for (const e of templeBrush({ x: 0, y: 0, w: 10, h: 10 }, 7, c)) {
      expect(allowed.has(e.kind)).toBe(true);
    }
  });
});
