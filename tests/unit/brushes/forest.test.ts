import { describe, it, expect } from 'vitest';
import { forestBrush } from '@/world/brushes/forest';
import { placeVegetation, type VegetationParams } from '@/world/brushes/vegetation-placer';
import { canopyOf, undergrowthOf } from '@/flora/biome-flora';
import { EMPTY_CONTEXT } from '@/world/brush-helpers';
import type { BrushContext, GameMap, Tile } from '@/core/types';

const FOREST_CANOPY = new Set(canopyOf('forest').map(([k]) => k));
const FOREST_KINDS = new Set<string>([...FOREST_CANOPY, ...undergrowthOf('forest').map(([k]) => k)]);

function ctx(rows: string[][]): BrushContext {
  const h = rows.length, w = rows[0].length;
  const tiles: Tile[][] = rows.map((row, y) => row.map((type, x) => ({ type, x, y, walkable: true, state: 'realized' as const })));
  const map: GameMap = {
    tiles, width: w, height: h, villages: [], seed: 0,
    success: true, worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [],
  };
  return { ...EMPTY_CONTEXT, tiles: map };
}

const allForest = (w: number, h: number) =>
  ctx(Array.from({ length: h }, () => Array(w).fill('forest')));

describe('forest brush', () => {
  it('is deterministic — same seed, same input → equal output', () => {
    const c = allForest(8, 8);
    const r = { x: 0, y: 0, w: 8, h: 8 };
    expect(forestBrush(r, 42, c)).toEqual(forestBrush(r, 42, c));
  });

  it('produces a stable snapshot', () => {
    const c = allForest(8, 8);
    expect(forestBrush({ x: 0, y: 0, w: 8, h: 8 }, 42, c)).toMatchSnapshot();
  });

  it('emits zero entities on non-forest tiles', () => {
    // 'dirt' — a tile NO sub-brush covers (these brushes deliberately grass-cover
    // 'grass'/'meadow'/'glen' tiles via placeGrassCover, so grass is not foreign).
    const c = ctx([['dirt', 'dirt'], ['dirt', 'dirt']]);
    expect(forestBrush({ x: 0, y: 0, w: 2, h: 2 }, 1, c)).toEqual([]);
  });

  it('emits only the forest pool species (canopy + undergrowth)', () => {
    const c = allForest(16, 16);
    const out = forestBrush({ x: 0, y: 0, w: 16, h: 16 }, 7, c);
    for (const e of out) expect(FOREST_KINDS.has(e.kind)).toBe(true);
  });

  it('all emitted entities are inside the region (with sub-tile jitter tolerance)', () => {
    const c = allForest(16, 16);
    const r = { x: 4, y: 4, w: 8, h: 8 };
    for (const e of forestBrush(r, 1, c)) {
      // Tile coordinate (floor) must be inside region. Sub-tile jitter can push
      // floating x/y slightly outside, but the floor must still be in-region.
      const fx = Math.floor(e.x), fy = Math.floor(e.y);
      expect(fx).toBeGreaterThanOrEqual(r.x);
      expect(fx).toBeLessThan(r.x + r.w);
      expect(fy).toBeGreaterThanOrEqual(r.y);
      expect(fy).toBeLessThan(r.y + r.h);
    }
  });

  it('density ~0.35 on full-forest region produces ~30% density', () => {
    const c = allForest(20, 20);
    const out = forestBrush({ x: 0, y: 0, w: 20, h: 20 }, 13, c);
    expect(out.length).toBeGreaterThan(80);
    expect(out.length).toBeLessThan(200);
  });

  it('different seeds produce different output', () => {
    const c = allForest(16, 16);
    const r = { x: 0, y: 0, w: 16, h: 16 };
    const a = forestBrush(r, 1, c);
    const b = forestBrush(r, 999, c);
    expect(a).not.toEqual(b);
  });

  it('clumping makes placement spatially clustered (higher block variance than uniform)', () => {
    const c = allForest(40, 40);
    const r = { x: 0, y: 0, w: 40, h: 40 };
    const base: VegetationParams = {
      brush: 'forest', tileType: 'forest', kinds: [['english-oak', 1]],
      density: 0.35, scaleRange: [1, 1], rotationRange: 0, offsetRange: [0, 0],
    };
    // Variance of per-4×4-block tree counts: clumped should spread wider.
    const blockVar = (out: { x: number; y: number }[]): number => {
      const blocks = new Map<string, number>();
      for (const e of out) {
        const k = `${Math.floor(e.x / 4)},${Math.floor(e.y / 4)}`;
        blocks.set(k, (blocks.get(k) ?? 0) + 1);
      }
      const counts = Array.from({ length: 100 }, (_, i) => blocks.get(`${i % 10},${Math.floor(i / 10)}`) ?? 0);
      const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
      return counts.reduce((a, b) => a + (b - mean) ** 2, 0) / counts.length;
    };
    const uniform = blockVar(placeVegetation(r, 7, c, { ...base, clumpScale: 0 }));
    const clumped = blockVar(placeVegetation(r, 7, c, { ...base, clumpScale: 5 }));
    expect(clumped).toBeGreaterThan(uniform);
  });

  it('clumped placement is deterministic for a fixed seed', () => {
    const c = allForest(24, 24);
    const r = { x: 0, y: 0, w: 24, h: 24 };
    const p: VegetationParams = {
      brush: 'forest', tileType: 'forest', kinds: [['english-oak', 1]],
      density: 0.35, scaleRange: [0.6, 1.5], rotationRange: 0, offsetRange: [0.3, 0.3], clumpScale: 5,
    };
    expect(placeVegetation(r, 5, c, p)).toEqual(placeVegetation(r, 5, c, p));
  });
});

describe('vegetation scatter (anti-grid)', () => {
  const base: VegetationParams = {
    brush: 'forest', tileType: 'forest', kinds: [['english-oak', 1]],
    density: 0.6, scaleRange: [1, 1], rotationRange: 0, offsetRange: [0.5, 0.5], clumpScale: 0,
  };

  it('maxPerTile > 1 puts more than one tree in some cells', () => {
    const c = allForest(30, 30);
    const r = { x: 0, y: 0, w: 30, h: 30 };
    const out = placeVegetation(r, 9, c, { ...base, maxPerTile: 3 });
    const perCell = new Map<string, number>();
    for (const e of out) {
      const k = `${Math.floor(e.x)},${Math.floor(e.y)}`;
      perCell.set(k, (perCell.get(k) ?? 0) + 1);
    }
    expect(Math.max(...perCell.values())).toBeGreaterThan(1);
  });

  it('maxPerTile=1 caps at one tree per cell', () => {
    const c = allForest(30, 30);
    const r = { x: 0, y: 0, w: 30, h: 30 };
    const out = placeVegetation(r, 9, c, { ...base, maxPerTile: 1 });
    const perCell = new Map<string, number>();
    for (const e of out) {
      const k = `${Math.floor(e.x)},${Math.floor(e.y)}`;
      perCell.set(k, (perCell.get(k) ?? 0) + 1);
    }
    expect(Math.max(...perCell.values())).toBe(1);
  });

  it('positions fill the whole cell, not just the centre (frac spans [0,1))', () => {
    const c = allForest(30, 30);
    const r = { x: 0, y: 0, w: 30, h: 30 };
    const out = placeVegetation(r, 4, c, { ...base, maxPerTile: 2 });
    const fracs = out.map((e) => e.x - Math.floor(e.x));
    expect(Math.min(...fracs)).toBeLessThan(0.15);   // some near the low edge
    expect(Math.max(...fracs)).toBeGreaterThan(0.85); // some near the high edge
    // And every fraction is genuinely in-cell, so floor() never escapes.
    expect(fracs.every((f) => f >= 0 && f < 1)).toBe(true);
  });

  it('stored offsetX/offsetY equal the in-cell fraction (topdown reconstruction is exact)', () => {
    const c = allForest(12, 12);
    const r = { x: 0, y: 0, w: 12, h: 12 };
    for (const e of placeVegetation(r, 2, c, { ...base, maxPerTile: 2 })) {
      const tileX = Math.floor(e.x);
      // renderer.ts reconstructs worldX from (floor(e.x) + offsetX); it must equal e.x.
      expect(tileX + (e.properties!.offsetX as number)).toBeCloseTo(e.x);
    }
  });
});
