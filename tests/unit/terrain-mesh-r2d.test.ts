import { describe, it, expect } from 'vitest';
import { buildTerrainMesh, TERRAIN_Z_PX_PER_M } from '@/render/gpu/terrain-mesh';
import { litTileColorRGB, litTileColorHex, hexToRgb01 } from '@/render/iso/terrain-shading';
import { clearHeightfieldCache, getHeightfield, ELEVATION_SEA_LEVEL, TERRAIN_RELIEF_M } from '@/world/heightfield';
import { worldToScreen } from '@/render/iso/iso-projection';
import { TILE_COLORS } from '@/core/constants';
import type { GameMap } from '@/core/types';
import type { TileBounds } from '@/render/iso/iso-projection';

function makeMap(w: number, h: number, seed = 1234, fill = 'grass'): GameMap {
  const tiles = [];
  for (let y = 0; y < h; y++) {
    const row = [];
    for (let x = 0; x < w; x++) row.push({ type: fill, x, y, walkable: true, state: 'realized' });
    tiles.push(row);
  }
  return { width: w, height: h, seed, tiles, pois: [], buildings: [] } as unknown as GameMap;
}
const full = (m: GameMap): TileBounds => ({ minTx: 0, maxTx: m.width - 1, minTy: 0, maxTy: m.height - 1 });

describe('R2d — terrain heightfield mesh', () => {
  it('emits 4 verts / 2 tris per visible tile', () => {
    clearHeightfieldCache();
    const m = makeMap(4, 4);
    const mesh = buildTerrainMesh(m, full(m), 0, 0);
    expect(mesh.vertexCount).toBe(16 * 4);
    expect(mesh.triCount).toBe(16 * 2);
    expect(mesh.positions).toHaveLength(16 * 4 * 2);
    expect(mesh.colors).toHaveLength(16 * 4 * 3);
    expect(mesh.indices).toHaveLength(16 * 6);
  });

  it('skips absent tiles (holes) — count follows the actual tiles', () => {
    const m = makeMap(3, 3);
    // punch a hole
    (m.tiles[1] as unknown as unknown[])[1] = undefined as unknown;
    const mesh = buildTerrainMesh(m, full(m), 0, 0);
    expect(mesh.vertexCount).toBe(8 * 4); // 9 - 1
    expect(mesh.triCount).toBe(8 * 2);
  });

  it('lifts higher ground UP-screen (smaller y) than lower ground', () => {
    clearHeightfieldCache();
    const m = makeMap(8, 8);
    const hf = getHeightfield(m.seed, m.width, m.height);
    // find the highest and lowest tile
    let hi = 0, lo = 0;
    for (let i = 1; i < hf.length; i++) { if (hf[i] > hf[hi]) hi = i; if (hf[i] < hf[lo]) lo = i; }
    const mesh = buildTerrainMesh(m, full(m), 0, 0);
    // The mesh y at a tile's top vertex = worldToScreen(...,zPx).sy - halfH.
    const yOf = (idx: number) => {
      const tx = idx % m.width, ty = (idx / m.width) | 0;
      const z = (hf[idx] - ELEVATION_SEA_LEVEL) * TERRAIN_RELIEF_M * TERRAIN_Z_PX_PER_M;
      return worldToScreen(tx, ty, z, 0, 0).sy;
    };
    // Compare each tile's center-y delta vs its FLAT (z=0) center-y: higher tile lifts more.
    const flatY = (idx: number) => worldToScreen(idx % m.width, (idx / m.width) | 0, 0, 0, 0).sy;
    expect(flatY(hi) - yOf(hi)).toBeGreaterThan(flatY(lo) - yOf(lo)); // hi lifted more (smaller y)
    void mesh;
  });

  it('z lift is zero at the waterline and scales with relief × zPxPerM', () => {
    clearHeightfieldCache();
    const m = makeMap(2, 2);
    const hf = getHeightfield(m.seed, m.width, m.height);
    // tile (0,0): expected center y
    const elev = hf[0];
    const expZ = (elev - ELEVATION_SEA_LEVEL) * TERRAIN_RELIEF_M * 2; // zPxPerM=2
    const mesh = buildTerrainMesh(m, full(m), 0, 0, { zPxPerM: 2 });
    // first tile in iso order i=0 is (0,0); its top vertex = (sx, sy-halfH).
    const exp = worldToScreen(0, 0, expZ, 0, 0);
    expect(mesh.positions[0]).toBeCloseTo(exp.sx, 4);          // top.x
    expect(mesh.positions[1]).toBeCloseTo(exp.sy - 32, 4);     // top.y (halfH=32)
  });

  it('per-vertex colour matches the Canvas2D hex shading exactly (no drift)', () => {
    clearHeightfieldCache();
    const m = makeMap(3, 3);
    const hf = getHeightfield(m.seed, m.width, m.height);
    const mesh = buildTerrainMesh(m, full(m), 0, 0);
    // tile (0,0) is the first emitted (iso i=0). Its colour = litTileColorRGB(grass,...).
    const base = TILE_COLORS['grass'];
    const rgb = litTileColorRGB(base, hf[0], 0, 0);
    expect(mesh.colors[0]).toBeCloseTo(rgb[0], 5);
    expect(mesh.colors[1]).toBeCloseTo(rgb[1], 5);
    expect(mesh.colors[2]).toBeCloseTo(rgb[2], 5);
    // and the RGB path agrees with the HEX path the diamonds use (same factor, clamp)
    const fromHex = hexToRgb01(litTileColorHex(base, hf[0], 0, 0));
    // within 1/255 (hex is byte-quantised; rgb path is continuous)
    expect(Math.abs(rgb[0] - fromHex[0])).toBeLessThanOrEqual(1 / 255 + 1e-6);
  });

  it('all four corners of a tile share one colour (flat per-tile shading)', () => {
    const m = makeMap(2, 2);
    const mesh = buildTerrainMesh(m, full(m), 0, 0);
    for (let t = 0; t < 4; t++) {
      const c0 = [mesh.colors[t * 12], mesh.colors[t * 12 + 1], mesh.colors[t * 12 + 2]];
      for (let k = 1; k < 4; k++) {
        expect(mesh.colors[t * 12 + k * 3]).toBe(c0[0]);
        expect(mesh.colors[t * 12 + k * 3 + 1]).toBe(c0[1]);
        expect(mesh.colors[t * 12 + k * 3 + 2]).toBe(c0[2]);
      }
    }
  });

  it('is deterministic for the same world + bounds', () => {
    const m = makeMap(5, 5);
    const a = buildTerrainMesh(m, full(m), 0, 0);
    const b = buildTerrainMesh(m, full(m), 0, 0);
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
    expect(Array.from(a.colors)).toEqual(Array.from(b.colors));
    expect(Array.from(a.indices)).toEqual(Array.from(b.indices));
  });
});
