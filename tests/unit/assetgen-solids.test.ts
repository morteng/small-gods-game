import { describe, it, expect } from 'vitest';
import { getManifold } from '@/assetgen/geometry/manifold-runtime';
import { manifoldToFacets, solidBox, solidCylinder, solidCone, solidArch, buildingFacets } from '@/assetgen/geometry/solids';
import type { Wing } from '@/assetgen/geometry/building';

describe('manifoldToFacets', () => {
  it('emits one flat-shaded facet per mesh triangle of a closed cube', async () => {
    const { Manifold } = await getManifold();
    const mesh = Manifold.cube([1, 1, 1]).getMesh();
    const facets = manifoldToFacets(mesh, 'stone');
    expect(facets.length).toBe(mesh.numTri);          // 12 tris for a cube
    for (const f of facets) {
      expect(f.pts.length).toBe(3);
      const len = Math.hypot(...f.normal);
      expect(len).toBeGreaterThan(0.5);
      expect(f.albedo).toHaveLength(3);
    }
  });

  it('shades the top face (normal +z) brighter than a side face', async () => {
    const { Manifold } = await getManifold();
    const facets = manifoldToFacets(Manifold.cube([1, 1, 1]).getMesh(), 'plaster');
    const top = facets.find(f => f.normal[2] > 0.9)!;
    const side = facets.find(f => Math.abs(f.normal[2]) < 0.1)!;
    expect(top.albedo[0]).toBeGreaterThan(side.albedo[0]);
  });
});

describe('primitive solids', () => {
  it('solidBox spans at→at+size', async () => {
    const m = await solidBox([1, 2, 0], [2, 2, 3]);
    const bb = m.boundingBox();
    expect(bb.min).toEqual([1, 2, 0]);
    expect(bb.max[0]).toBeCloseTo(3, 5);
    expect(bb.max[2]).toBeCloseTo(3, 5);
  });

  it('solidCylinder sits on baseZ with the right radius and height', async () => {
    const m = await solidCylinder([0, 0], 1, 0.5, 2);
    const bb = m.boundingBox();
    expect(bb.min[2]).toBeCloseTo(1, 5);
    expect(bb.max[2]).toBeCloseTo(3, 5);
    expect(bb.max[0]).toBeCloseTo(0.5, 2);
  });

  it('solidCone tapers to a point (volume < equivalent cylinder)', async () => {
    const cone = await solidCone([0, 0], 0, 0, 1, 2);
    const cyl = await solidCylinder([0, 0], 0, 1, 2);
    expect(cone.volume()).toBeLessThan(cyl.volume());
    expect(cone.volume()).toBeGreaterThan(0);
  });

  it('solidArch is a single connected post-and-lintel solid', async () => {
    const m = await solidArch([0, 0, 0], 2, 2, 0.4);
    expect(m.volume()).toBeGreaterThan(0);
    const bb = m.boundingBox();
    expect(bb.max[0]).toBeCloseTo(2, 2);        // spans the full span in +x
    expect(bb.max[2]).toBeCloseTo(2.4, 2);      // height + lintel thickness
  });
});

describe('buildingFacets (manifold)', () => {
  const cross: Wing[] = [
    { x: 0, y: 1, w: 4, h: 2 },   // nave (long axis x)
    { x: 1, y: 0, w: 2, h: 4 },   // transept (long axis y)
  ];

  it('emits facets for a multi-wing footprint without throwing', async () => {
    const facets = await buildingFacets(cross, 'plaster', 'tile', 'gable');
    expect(facets.length).toBeGreaterThan(0);
  });

  it('roof reaches above the wall top (a ridge exists)', async () => {
    const facets = await buildingFacets(cross, 'plaster', 'tile', 'gable');
    const maxZ = Math.max(...facets.flatMap(f => f.pts.map(p => p[2])));
    expect(maxZ).toBeGreaterThan(2.1);   // STOREY = 2.1 wall top
  });

  it('hip roof of a single square wing peaks at one apex', async () => {
    const square: Wing[] = [{ x: 0, y: 0, w: 2, h: 2 }];
    const facets = await buildingFacets(square, 'plaster', 'tile', 'hip');
    const top = Math.max(...facets.flatMap(f => f.pts.map(p => p[2])));
    const apexPts = facets.flatMap(f => f.pts).filter(p => Math.abs(p[2] - top) < 1e-6);
    const xs = new Set(apexPts.map(p => p[0].toFixed(3)));
    const ys = new Set(apexPts.map(p => p[1].toFixed(3)));
    expect(xs.size).toBe(1);
    expect(ys.size).toBe(1);
  });
});
