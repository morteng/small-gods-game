// tests/unit/poi-ground-patches.test.ts
import { describe, it, expect } from 'vitest';
import { applyPoiGroundPatches, registerPoiGroundPatch, POI_GROUND_PATCHES } from '@/world/poi-ground-patches';
import type { POI, Tile } from '@/core/types';

function grid(w = 40, h = 40, type = 'grass'): Tile[][] {
  return Array.from({ length: h }, (_, y) =>
    Array.from({ length: w }, (_, x) => ({ x, y, type, walkable: true }) as unknown as Tile));
}

const temple = (x: number, y: number, size: POI['size'] = 'medium'): POI =>
  ({ id: 't', type: 'temple', position: { x, y }, size } as POI);

describe('applyPoiGroundPatches — connectome mini-biomes', () => {
  it('stamps a sacred grove around a temple', () => {
    const tiles = grid();
    const changed = applyPoiGroundPatches([temple(20, 20)], tiles, 7);
    expect(changed).toBeGreaterThan(0);
    // The temple's own tile is well inside the patch → always converted.
    expect(tiles[20][20].type).toBe('sacred_grove');
  });

  it('stays within the (size-scaled) radius — never paints far away', () => {
    const tiles = grid();
    applyPoiGroundPatches([temple(20, 20, 'medium')], tiles, 7);
    // radius 6 × medium(1) = 6; nothing beyond it should change.
    expect(tiles[20][20 + 9].type).toBe('grass');
    expect(tiles[20 + 9][20].type).toBe('grass');
  });

  it('a large temple grows a bigger grove than a small one', () => {
    const big = grid();
    const small = grid();
    const a = applyPoiGroundPatches([temple(20, 20, 'large')], big, 7);
    const b = applyPoiGroundPatches([temple(20, 20, 'small')], small, 7);
    expect(a).toBeGreaterThan(b);
  });

  it('never overwrites water, sand, or roads', () => {
    const tiles = grid();
    for (let y = 15; y < 26; y++) for (let x = 15; x < 26; x++) tiles[y][x].type = 'shallow_water';
    tiles[20][22].type = 'dirt_road';
    tiles[20][18].type = 'sand';
    applyPoiGroundPatches([temple(20, 20)], tiles, 7);
    expect(tiles[20][22].type).toBe('dirt_road');
    expect(tiles[20][18].type).toBe('sand');
    expect(tiles[18][18].type).toBe('shallow_water');
  });

  it('is deterministic and POIs without a patch are no-ops', () => {
    const a = grid(), b = grid();
    const villages: POI[] = [{ id: 'v', type: 'village', position: { x: 20, y: 20 } } as POI];
    expect(applyPoiGroundPatches(villages, a, 7)).toBe(0);
    const t = [temple(20, 20)];
    applyPoiGroundPatches(t, a, 7);
    applyPoiGroundPatches(t, b, 7);
    expect(a.map(r => r.map(c => c.type))).toEqual(b.map(r => r.map(c => c.type)));
  });

  it('exposes an open registry seam', () => {
    expect(POI_GROUND_PATCHES.temple.tile).toBe('sacred_grove');
    registerPoiGroundPatch('shrine', { tile: 'sacred_grove', radius: 3 });
    expect(POI_GROUND_PATCHES.shrine.radius).toBe(3);
    delete POI_GROUND_PATCHES.shrine;
  });
});
