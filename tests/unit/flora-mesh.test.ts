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

  it('blobFacets makes a closed low-poly clump per leaf', () => {
    const f = blobFacets([{ at: [0, 0, 1], r: 0.5 }], 'foliage', { subdiv: 1, jitter: 0 });
    expect(f.length).toBe(32); // octahedron (8) subdivided once
    expect(f.every(x => x.mat === 'foliage')).toBe(true);
  });

  it('blobFacets crown-radial re-aim points normals outward from the crown centre', () => {
    // A clump offset +X from the crown centre: with the re-aim on, its facet normals
    // should lean +X (outward) on average vs the untouched control.
    const leaves = [{ at: [2, 0, 0] as [number, number, number], r: 0.5 }];
    const flat = blobFacets(leaves, 'foliage', { subdiv: 1, jitter: 0 });
    const crown = blobFacets(leaves, 'foliage', { subdiv: 1, jitter: 0, crownCenter: [0, 0, 0], crownMode: 'point', radialK: 0.7 });
    const meanNX = (fs: typeof flat): number =>
      fs.reduce((a, f) => { const l = Math.hypot(...f.normal) || 1; return a + f.normal[0] / l; }, 0) / fs.length;
    expect(crown).toHaveLength(flat.length);
    expect(meanNX(crown)).toBeGreaterThan(meanNX(flat)); // biased outward (+X)
    for (const f of crown) expect(f.normal.every(finite)).toBe(true);
  });

  it('blobFacets axis mode re-aims horizontally (no Z component from the radial)', () => {
    // A leaf offset +X and +Z from the axis at (0,0): axis mode measures outward from
    // the vertical axis at the facet height, so the radial target has no Z — the
    // resulting normals stay flatter in Z than point mode toward an origin below.
    const leaves = [{ at: [2, 0, 3] as [number, number, number], r: 0.5 }];
    const axis = blobFacets(leaves, 'foliage', { subdiv: 1, jitter: 0, crownCenter: [0, 0, 0], crownMode: 'axis', radialK: 1 });
    // radialK=1 fully radial; axis radial is purely horizontal ⇒ every facet normal Z ≈ 0.
    for (const f of axis) {
      const l = Math.hypot(...f.normal) || 1;
      expect(Math.abs(f.normal[2] / l)).toBeLessThan(1e-6);
    }
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
