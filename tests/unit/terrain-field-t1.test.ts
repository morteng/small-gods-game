import { describe, it, expect } from 'vitest';
import {
  hexToAbgr, terrainGrid, packColorField, buildTerrainField,
  TERRAIN_Z_PX_PER_M, MAX_TERRAIN_QUADS, curveRenderElev, curveHeightBuffer,
  zoomCoarsenMaxQuads, terrainLiftMarginTiles,
} from '@/render/gpu/terrain-field';
import { ISO_TILE_W } from '@/render/iso/iso-constants';
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

describe('curveRenderElev', () => {
  const sea = 0.35;
  it('is identity at gamma 1', () => {
    for (const e of [0, 0.2, 0.35, 0.6, 0.99]) expect(curveRenderElev(e, sea, 1)).toBe(e);
  });
  it('leaves sea level and everything below unchanged at any gamma', () => {
    expect(curveRenderElev(sea, sea, 2)).toBe(sea);
    expect(curveRenderElev(0.1, sea, 2)).toBe(0.1);
    expect(curveRenderElev(-1, sea, 2)).toBe(-1); // the dry sentinel passes through
  });
  it('keeps the peak (a=1) but pushes mid slopes down at gamma>1', () => {
    expect(curveRenderElev(1, sea, 2)).toBeCloseTo(1, 9);  // a=1 ⇒ a^g=1
    const span = 1 - sea;
    const mid = sea + 0.5 * span;                          // a = 0.5
    const out = curveRenderElev(mid, sea, 2);
    expect(out).toBeCloseTo(sea + 0.25 * span, 9);         // a^2 = 0.25
    expect(out).toBeLessThan(mid);                         // flatter than linear
  });
  it('is monotonic (preserves ordering ⇒ the waterline zero-crossing)', () => {
    const g = 1.8;
    let prev = -Infinity;
    for (let e = sea; e <= 1; e += 0.05) {
      const v = curveRenderElev(e, sea, g);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});

describe('curveHeightBuffer', () => {
  it('returns the SAME array reference at gamma 1 (byte-parity, no alloc)', () => {
    const base = new Float32Array([0.2, 0.35, 0.6, 0.99]);
    expect(curveHeightBuffer(base, 0.35, 1)).toBe(base);
  });
  it('curves a copy at gamma>1, leaving the base untouched', () => {
    const base = new Float32Array([0.2, 0.35, 0.675, 1]);
    const before2 = base[2];
    const out = curveHeightBuffer(base, 0.35, 2);
    expect(out).not.toBe(base);
    expect(base[2]).toBe(before2);               // base unmutated
    expect(out[0]).toBeCloseTo(0.2, 6);          // below sea: identity
    expect(out[1]).toBeCloseTo(0.35, 6);         // at sea: identity
    expect(out[3]).toBeCloseTo(1, 6);            // peak preserved
    expect(out[2]).toBeLessThan(before2);        // mid slope flattened
  });
  it('memoises by (base identity, gamma)', () => {
    const base = new Float32Array([0.5, 0.8]);
    expect(curveHeightBuffer(base, 0.35, 2)).toBe(curveHeightBuffer(base, 0.35, 2));
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

describe('terrainGrid viewport cull (T5)', () => {
  it('is byte-identical to the un-culled grid for the whole-map window', () => {
    const W = 100, H = 80;
    const full = terrainGrid(W, H);
    const windowed = terrainGrid(W, H, MAX_TERRAIN_QUADS, 1, [0, 0, W - 1, H - 1]);
    expect(windowed.subsample).toBe(full.subsample);
    expect(windowed.quadsX).toBe(full.quadsX);
    expect(windowed.quadsY).toBe(full.quadsY);
    expect(windowed.vertexCount).toBe(full.vertexCount);
    expect(windowed.window).toEqual([0, 0, W, H]);
  });

  it('emits only the windowed quads — far fewer than the full map', () => {
    const W = 384, H = 272;
    // A 30×30-tile visible rect somewhere mid-map.
    const g = terrainGrid(W, H, MAX_TERRAIN_QUADS, 1, [100, 100, 129, 129]);
    expect(g.subsample).toBe(1);          // LOD still chosen map-wide
    expect(g.window).toEqual([100, 100, 30, 30]);
    expect(g.vertexCount).toBe(30 * 30 * 6);
    expect(g.vertexCount).toBeLessThan(terrainGrid(W, H).vertexCount / 50);
  });

  it('snaps the origin DOWN and span UP to the subsample lattice', () => {
    // Force subsample 2 via a tight cap, then a window mis-aligned to the lattice.
    const W = 400, H = 400;
    const cap = Math.floor(W / 2) * Math.floor(H / 2); // forces subsample 2
    const g = terrainGrid(W, H, cap, 1, [7, 7, 22, 22]);
    expect(g.subsample).toBe(2);
    // origin floored to a multiple of 2 (6), span ceiled to cover [7..23) → [6..24) = 18
    expect(g.window[0]).toBe(6);
    expect(g.window[1]).toBe(6);
    expect(g.window[0] % 2).toBe(0);
    expect(g.window[2] % 2).toBe(0);
    expect(g.vertexCount).toBe((g.window[2] / 2) * (g.window[3] / 2) * 6);
  });

  it('clamps the window to the map and never emits zero quads', () => {
    const W = 50, H = 50;
    const g = terrainGrid(W, H, MAX_TERRAIN_QUADS, 1, [-20, -20, 999, 999]);
    expect(g.window).toEqual([0, 0, W, H]);   // whole map after clamp
    expect(g.vertexCount).toBe(W * H * 6);
    // A degenerate window past the map still yields one quad, not zero.
    const deg = terrainGrid(W, H, MAX_TERRAIN_QUADS, 1, [60, 60, 70, 70]);
    expect(deg.vertexCount).toBeGreaterThan(0);
  });

  it('respects supersample subdivision inside the window', () => {
    const W = 100, H = 100;
    const g = terrainGrid(W, H, MAX_TERRAIN_QUADS, 2, [10, 10, 19, 19]); // 10-tile span, ×2 subdivide
    expect(g.window).toEqual([10, 10, 10, 10]);
    expect(g.vertexCount).toBe(10 * 2 * 10 * 2 * 6);
  });
});

describe('terrainLiftMarginTiles', () => {
  it('is a small non-negative tile count for a flat map (no peaks)', () => {
    const flat = tinyMap(40, 40); // all grass at sea-ish level, no POIs
    const m = terrainLiftMarginTiles(flat);
    expect(m).toBeGreaterThanOrEqual(1);
    expect(m).toBeLessThan(20);
  });
});

describe('zoomCoarsenMaxQuads (zoom-out LOD)', () => {
  const W = 384, H = 272;
  // sx such that a tile spans `px` low-res art-pixels: tileArtPx = ISO_TILE_W·sx.
  const sxFor = (tileArtPx: number) => tileArtPx / ISO_TILE_W;

  it('does not coarsen once tiles are at/above the target size', () => {
    // A comfortably-zoomed-in tile (≥ target px) keeps the full quad budget so the
    // subdivide half (zoomSuperSample) can take over without fighting a low cap.
    expect(zoomCoarsenMaxQuads(W, H, sxFor(20))).toBe(MAX_TERRAIN_QUADS);
    expect(zoomCoarsenMaxQuads(W, H, sxFor(8))).toBe(MAX_TERRAIN_QUADS);
  });

  it('coarsens the shared grid when a tile is sub-pixel-ish (fit-zoom)', () => {
    // ~2.8 art-px/tile (the default world at fit) → a cap that forces subsample > 1,
    // i.e. fewer quads than the full grid.
    const cap = zoomCoarsenMaxQuads(W, H, sxFor(2.8));
    const full = terrainGrid(W, H).quadsX * terrainGrid(W, H).quadsY;
    expect(cap).toBeLessThan(full);
    const g = terrainGrid(W, H, cap);
    expect(g.subsample).toBeGreaterThan(1);
  });

  it('never coarsens past the silhouette-protecting bound', () => {
    // Even at an absurd zoom-out the subsample is capped (ZOOM_COARSEN_MAX = 4): the
    // grid never drops below ⌊W/4⌋·⌊H/4⌋ quads.
    const cap = zoomCoarsenMaxQuads(W, H, sxFor(0.01));
    const floorQuads = Math.floor(W / 4) * Math.floor(H / 4);
    expect(cap).toBeGreaterThanOrEqual(floorQuads);
    expect(terrainGrid(W, H, cap).subsample).toBeLessThanOrEqual(4);
  });
});

describe('packColorField', () => {
  it('produces one opaque colour per cell, row-major', () => {
    const map = tinyMap(3, 2);
    const colors = packColorField(map);
    expect(colors).toHaveLength(6);
    for (const c of colors) expect((c >>> 24) & 0xff).toBe(0xff); // alpha opaque
  });

  it('paints LAKE basins as a damp bed (never blue) so a drought reveals ground', () => {
    // 3×1 grass strip; the middle cell is classified a lake by hydrology. With the
    // waterType array it must NOT keep the grass colour OR turn blue — it becomes a
    // darkened damp bed (inherited from the dry grass neighbour) that the water pass
    // covers at full level and reveals on drought.
    const map = tinyMap(3, 1);
    const wt = new Uint8Array([0 /*Dry*/, 2 /*Lake*/, 0 /*Dry*/]);
    const colors = packColorField(map, undefined, wt);
    const lum = (c: number) => 0.2126 * (c & 0xff) + 0.7152 * ((c >> 8) & 0xff) + 0.0722 * ((c >> 16) & 0xff);
    expect(colors[1]).not.toBe(colors[0]);          // bed differs from dry grass
    expect(lum(colors[1])).toBeLessThan(lum(colors[0])); // and is darker (wet sheen)
    expect((colors[1] >>> 24) & 0xff).toBe(0xff);   // still opaque
    expect(colors[2]).toBe(colors[0]);              // dry neighbour untouched
  });

  it('leaves OCEAN cells alone (the sea is the datum — no drained bed)', () => {
    // An ocean-classified cell keeps its tile colour; only river/lake beds remap.
    const map = tinyMap(2, 1);
    const wt = new Uint8Array([1 /*Ocean*/, 0 /*Dry*/]);
    const colors = packColorField(map, undefined, wt);
    expect(colors[0]).toBe(colors[1]); // both render the underlying grass tile colour
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
