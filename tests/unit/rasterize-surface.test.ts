import { describe, it, expect } from 'vitest';
import { rasterizeMaps } from '@/assetgen/render/rasterize';
import { projectFacets } from '@/assetgen/render/projection';
import type { WorldFacet } from '@/assetgen/types';

// A single large vertical wall facet (facing +y), spanning a few metres in x and z, so the
// rasterizer has plenty of opaque pixels to texture. World units are tiles (1 tile = 2 m).
const wall: WorldFacet = {
  pts: [[0, 2, 0], [4, 2, 0], [4, 2, 3], [0, 2, 3]],
  normal: [0, 1, 0],
  albedo: [150, 78, 58],   // brick grey-ref
  mat: 'brick',
};
const fit = { scale: 24, ox: 64, oy: 96 };

function opaqueAlbedos(maps: ReturnType<typeof rasterizeMaps>): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let i = 0; i < maps.size * maps.size; i++) {
    if (maps.albedo[i * 4 + 3] === 255) out.push([maps.albedo[i * 4], maps.albedo[i * 4 + 1], maps.albedo[i * 4 + 2]]);
  }
  return out;
}

describe('rasterizeMaps — surface texturing (K0b)', () => {
  const screen = projectFacets([wall], fit);
  const size = 128;

  it('flag OFF is the original flat per-facet fill (every opaque pixel = facet albedo)', () => {
    const maps = rasterizeMaps(screen, size);
    const px = opaqueAlbedos(maps);
    expect(px.length).toBeGreaterThan(100);
    expect(px.every((c) => c[0] === 150 && c[1] === 78 && c[2] === 58)).toBe(true);
  });

  it('flag ON textures the surface — opaque pixels vary (mortar joints + clay variance)', () => {
    const maps = rasterizeMaps(screen, size, { unitsPerMetre: 0.5 });
    const px = opaqueAlbedos(maps);
    expect(px.length).toBeGreaterThan(100);
    const distinct = new Set(px.map((c) => `${c[0]},${c[1]},${c[2]}`));
    expect(distinct.size).toBeGreaterThan(8);   // real spatial variation, not a flat fill
    // mean stays near the brick grey-ref (texturing modulates, doesn't recolour wholesale)
    const mean = px.reduce((a, c) => [a[0] + c[0], a[1] + c[1], a[2] + c[2]], [0, 0, 0])
      .map((s) => s / px.length);
    expect(mean[0]).toBeGreaterThan(110); expect(mean[0]).toBeLessThan(170);
  });

  it('flag ON also writes a varying roughness channel and perturbed normals', () => {
    const flat = rasterizeMaps(screen, size);
    const tex = rasterizeMaps(screen, size, { unitsPerMetre: 0.5 });
    // normals: flat facet writes one constant normal; textured perturbs per pixel
    const flatNormals = new Set<string>(), texNormals = new Set<string>();
    for (let i = 0; i < size * size; i++) {
      if (tex.albedo[i * 4 + 3] !== 255) continue;
      flatNormals.add(`${flat.normal[i * 4]},${flat.normal[i * 4 + 1]},${flat.normal[i * 4 + 2]}`);
      texNormals.add(`${tex.normal[i * 4]},${tex.normal[i * 4 + 1]},${tex.normal[i * 4 + 2]}`);
    }
    expect(flatNormals.size).toBe(1);            // flat = one facet normal
    expect(texNormals.size).toBeGreaterThan(4);  // textured = relief-perturbed
  });

  it('is deterministic across runs', () => {
    const a = rasterizeMaps(screen, size, { unitsPerMetre: 0.5 });
    const b = rasterizeMaps(screen, size, { unitsPerMetre: 0.5 });
    expect(Array.from(a.albedo)).toEqual(Array.from(b.albedo));
  });
});
