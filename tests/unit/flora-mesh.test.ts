// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { tubeFacets, blobFacets, rockFacets } from '@/assetgen/geometry/flora/mesh';

const finite = (n: number): boolean => Number.isFinite(n);

describe('flora mesh builders', () => {
  it('tubeFacets builds 4 triangles per side (2 wall + 2 caps) with finite normals', () => {
    const f = tubeFacets([{ a: [0, 0, 0], b: [0, 0, 2], r0: 0.3, r1: 0.2 }], 'bark', 5);
    expect(f).toHaveLength(20); // 5 sides × (2 wall + base + tip)
    for (const facet of f) {
      expect(facet.pts).toHaveLength(3);
      expect(facet.normal.every(finite)).toBe(true);
      expect(Math.hypot(...facet.normal)).toBeGreaterThan(0);
      expect(facet.mat).toBe('bark');
    }
  });

  it('tubeFacets skips zero-length limbs', () => {
    expect(tubeFacets([{ a: [1, 1, 1], b: [1, 1, 1], r0: 0.2, r1: 0.2 }], 'bark')).toHaveLength(0);
  });

  it('blobFacets makes a closed low-poly sphere per leaf', () => {
    const f = blobFacets([{ at: [0, 0, 1], r: 0.5 }], 'foliage', 1);
    expect(f.length).toBe(32); // octahedron (8) subdivided once
    expect(f.every(x => x.mat === 'foliage')).toBe(true);
  });

  it('rockFacets is non-empty and deterministic per seed, varies by seed', () => {
    const a = rockFacets({ center: [0, 0], baseZ: 0, radius: 1, seed: 7 });
    const b = rockFacets({ center: [0, 0], baseZ: 0, radius: 1, seed: 7 });
    const c = rockFacets({ center: [0, 0], baseZ: 0, radius: 1, seed: 8 });
    expect(a.length).toBeGreaterThan(0);
    expect(a.map(f => f.pts)).toEqual(b.map(f => f.pts));
    expect(a.map(f => f.pts)).not.toEqual(c.map(f => f.pts));
  });
});
