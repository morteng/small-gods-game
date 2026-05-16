import { describe, it, expect } from 'vitest';
import { villageBrush } from '@/world/brushes/village';
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
  for (const b of buildings) {
    world.addEntity({ id: b.id, kind: 'cottage', x: b.x, y: b.y, tags: ['building'] });
  }
  return { world: world.asReadOnly(), tiles: base.tiles };
}

const grass = (w: number, h: number) => Array.from({ length: h }, () => Array<string>(w).fill('grass'));

describe('village brush', () => {
  it('is deterministic', () => {
    const c = buildCtx(grass(8, 8));
    const r = { x: 0, y: 0, w: 8, h: 8 };
    expect(villageBrush(r, 42, c)).toEqual(villageBrush(r, 42, c));
  });

  it('produces a stable snapshot', () => {
    const c = buildCtx(grass(8, 8));
    expect(villageBrush({ x: 0, y: 0, w: 8, h: 8 }, 42, c)).toMatchSnapshot();
  });

  it('emits at most one well at the region center', () => {
    const c = buildCtx(grass(10, 10));
    const out = villageBrush({ x: 0, y: 0, w: 10, h: 10 }, 1, c);
    const wells = out.filter(e => e.kind === 'well');
    expect(wells.length).toBe(1);
    // Center of {0,0,10,10} → cx=5, cy=5; well placed at center tile + 0.5 offset
    expect(Math.floor(wells[0].x)).toBe(5);
    expect(Math.floor(wells[0].y)).toBe(5);
  });

  it('places well at nearest non-building tile when center has a building', () => {
    const rows = grass(10, 10);
    const ctx = buildCtxWithWorld(rows, [{ id: 'cottage-at-center', x: 5, y: 5 }]);
    const out = villageBrush({ x: 0, y: 0, w: 10, h: 10 }, 1, ctx);
    const wells = out.filter(e => e.kind === 'well');
    expect(wells.length).toBe(1);
    // Center (5,5) is blocked; spiral finds an immediate Chebyshev neighbor
    expect(Math.floor(wells[0].x)).not.toBe(5);
    expect(Math.floor(wells[0].y)).not.toBe(5);
    expect(Math.abs(Math.floor(wells[0].x) - 5)).toBeLessThanOrEqual(1);
    expect(Math.abs(Math.floor(wells[0].y) - 5)).toBeLessThanOrEqual(1);
  });

  it('skips well if all tiles within search radius are blocked', () => {
    const rows = grass(10, 10);
    const buildings: Array<{ id: string; x: number; y: number }> = [];
    // Fill the entire 7x7 Chebyshev-radius-3 area around (5,5) with buildings
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        buildings.push({ id: `b-${dx}-${dy}`, x: 5 + dx, y: 5 + dy });
      }
    }
    const ctx = buildCtxWithWorld(rows, buildings);
    const out = villageBrush({ x: 0, y: 0, w: 10, h: 10 }, 1, ctx);
    expect(out.some(e => e.kind === 'well')).toBe(false);
  });

  it('does not emit props on building tiles', () => {
    const rows = grass(10, 10);
    // Buildings at every tile of the top row (y=0)
    const buildings: Array<{ id: string; x: number; y: number }> = [];
    for (let x = 0; x < 10; x++) buildings.push({ id: `b-${x}`, x, y: 0 });
    const ctx = buildCtxWithWorld(rows, buildings);
    const out = villageBrush({ x: 0, y: 0, w: 10, h: 10 }, 7, ctx);
    expect(out.some(e => Math.floor(e.y) === 0)).toBe(false);
  });

  it('does not place fence posts or props on road tiles', () => {
    // Road across the top row
    const rows = grass(10, 10);
    for (let x = 0; x < 10; x++) rows[0][x] = 'dirt_road';
    const c = buildCtx(rows);
    const out = villageBrush({ x: 0, y: 0, w: 10, h: 10 }, 3, c);
    expect(out.some(e => Math.floor(e.y) === 0)).toBe(false);
  });

  it('emits fence_posts along the region boundary', () => {
    const c = buildCtx(grass(10, 10));
    const out = villageBrush({ x: 0, y: 0, w: 10, h: 10 }, 5, c);
    const fences = out.filter(e => e.kind === 'fence_post');
    // ~50% density on top + bottom rows = ~10 on average from 20 tiles
    expect(fences.length).toBeGreaterThan(0);
    for (const f of fences) {
      const fy = Math.floor(f.y);
      expect(fy === 0 || fy === 9).toBe(true);
    }
  });
});
