import { describe, it, expect } from 'vitest';
import {
  hexToAbgr, terrainGrid, packColorField, buildTerrainField,
  TERRAIN_Z_PX_PER_M, MAX_TERRAIN_QUADS,
} from '@/render/gpu/terrain-field';
import { DEFAULT_LIGHTING } from '@/render/lighting-state';
import type { GameMap, Tile } from '@/core/types';

function tinyMap(w: number, h: number): GameMap {
  const tiles: Tile[][] = [];
  for (let y = 0; y < h; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < w; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
    tiles.push(row);
  }
  return {
    tiles, width: w, height: h, villages: [], seed: 1234, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [],
  };
}

describe('hexToAbgr', () => {
  it('packs #rrggbb to 0xFFBBGGRR (opaque, byte-reversed for LE upload)', () => {
    expect(hexToAbgr('#ff0000') >>> 0).toBe(0xff0000ff); // red → R in low byte
    expect(hexToAbgr('#00ff00') >>> 0).toBe(0xff00ff00);
    expect(hexToAbgr('#0000ff') >>> 0).toBe(0xffff0000); // blue → B in high colour byte
  });
  it('falls back to opaque grey on a bad hex', () => {
    expect(hexToAbgr('nope') >>> 0).toBe(0xff444444);
  });
});

describe('terrainGrid LOD', () => {
  it('uses full resolution under the quad cap', () => {
    const g = terrainGrid(64, 48);
    expect(g.subsample).toBe(1);
    expect(g.quadsX).toBe(64);
    expect(g.quadsY).toBe(48);
    expect(g.vertexCount).toBe(64 * 48 * 6);
  });
  it('subsamples to honour the quad cap on a big map', () => {
    const g = terrainGrid(2000, 2000, MAX_TERRAIN_QUADS);
    expect(g.subsample).toBeGreaterThan(1);
    expect(g.quadsX * g.quadsY).toBeLessThanOrEqual(MAX_TERRAIN_QUADS);
  });
});

describe('packColorField', () => {
  it('produces one opaque colour per cell, row-major', () => {
    const map = tinyMap(3, 2);
    const colors = packColorField(map);
    expect(colors).toHaveLength(6);
    for (const c of colors) expect((c >>> 24) & 0xff).toBe(0xff); // alpha opaque
  });
});

describe('buildTerrainField', () => {
  it('assembles heights/colours/vertexCount and packs globals from camera+lighting', () => {
    const map = tinyMap(8, 8);
    const field = buildTerrainField(map, {
      viewport: [800, 600],
      xform: { sx: 2, sy: 2, ox: 4, oy: 6 },
      lighting: DEFAULT_LIGHTING,
    });
    expect(field.heights).toHaveLength(64);
    expect(field.colors).toHaveLength(64);
    expect(field.vertexCount).toBe(8 * 8 * 6);
    expect(field.globals.grid).toEqual([8, 8]);
    expect(field.globals.half).toEqual([64, 32]);
    expect(field.globals.zPxPerM).toBe(TERRAIN_Z_PX_PER_M);
    expect(field.globals.bands).toBe(DEFAULT_LIGHTING.bands);
    expect(field.globals.viewport).toEqual([800, 600]);
  });
});
