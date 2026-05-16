import { describe, it, expect } from 'vitest';
import { farmBrush } from '@/world/brushes/farm';
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
  for (const b of buildings) world.addEntity({ id: b.id, kind: 'farm_barn', x: b.x, y: b.y, tags: ['building'] });
  return { world: world.asReadOnly(), tiles: base.tiles };
}

const allFarm = (w: number, h: number) => Array.from({ length: h }, () => Array<string>(w).fill('farm_field'));

describe('farm brush', () => {
  it('is deterministic', () => {
    const c = buildCtx(allFarm(8, 8));
    const r = { x: 0, y: 0, w: 8, h: 8 };
    expect(farmBrush(r, 42, c)).toEqual(farmBrush(r, 42, c));
  });

  it('produces a stable snapshot', () => {
    const c = buildCtx(allFarm(8, 8));
    expect(farmBrush({ x: 0, y: 0, w: 8, h: 8 }, 42, c)).toMatchSnapshot();
  });

  it('emits crop_row on every farm_field tile (minus center scarecrow)', () => {
    const c = buildCtx(allFarm(8, 8));
    const out = farmBrush({ x: 0, y: 0, w: 8, h: 8 }, 1, c);
    const crops = out.filter(e => e.kind === 'crop_row');
    // 64 tiles - 1 (scarecrow at center) = 63
    expect(crops.length).toBe(63);
  });

  it('emits crop_rows on grass tiles (with sparse hay_bales)', () => {
    const grass = (w: number, h: number) => Array.from({ length: h }, () => Array<string>(w).fill('grass'));
    const c = buildCtx(grass(8, 8));
    const out = farmBrush({ x: 0, y: 0, w: 8, h: 8 }, 1, c);
    const crops = out.filter(e => e.kind === 'crop_row');
    const hay = out.filter(e => e.kind === 'hay_bale');
    // crops dominate, hay is rare (~3% noise rate)
    expect(crops.length).toBeGreaterThan(40);
    expect(crops.length + hay.length).toBe(63); // 64 - 1 scarecrow
  });

  it('emits one scarecrow at the region center', () => {
    const c = buildCtx(allFarm(10, 10));
    const out = farmBrush({ x: 0, y: 0, w: 10, h: 10 }, 1, c);
    const scarecrows = out.filter(e => e.kind === 'scarecrow');
    expect(scarecrows.length).toBe(1);
    expect(Math.floor(scarecrows[0].x)).toBe(5);
  });

  it('skips crop_row on a tile occupied by a building', () => {
    const rows = allFarm(8, 8);
    const ctx = buildCtxWithWorld(rows, [{ id: 'barn', x: 2, y: 2 }]);
    const out = farmBrush({ x: 0, y: 0, w: 8, h: 8 }, 1, ctx);
    expect(out.some(e => Math.floor(e.x) === 2 && Math.floor(e.y) === 2 && e.kind === 'crop_row')).toBe(false);
  });

  it('only emits allowed kinds', () => {
    const c = buildCtx(allFarm(8, 8));
    const allowed = new Set(['crop_row', 'scarecrow', 'hay_bale', 'fence_post']);
    for (const e of farmBrush({ x: 0, y: 0, w: 8, h: 8 }, 7, c)) {
      expect(allowed.has(e.kind)).toBe(true);
    }
  });
});
