import { describe, it, expect } from 'vitest';
import { getManifold } from '@/assetgen/geometry/manifold-runtime';
import { manifoldToFacets, solidBox, solidCylinder, solidCone, solidArch, buildingFacets } from '@/assetgen/geometry/solids';
import type { Wing } from '@/assetgen/geometry/building';
import { MATERIAL_RGB } from '@/assetgen/types';

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
  const noVents = { vents: [] };  // isolate the bare massing
  // manifoldToFacets shades each facet's albedo by a per-face brightness factor, so we
  // identify a material by its preserved channel RATIO rather than exact values.
  const isMat = (albedo: readonly number[], base: readonly number[]): boolean => {
    const f = albedo[0] / base[0];
    return f > 0.3 && f <= 1.01
      && Math.abs(albedo[1] - base[1] * f) <= 2
      && Math.abs(albedo[2] - base[2] * f) <= 2;
  };

  it('emits facets for a multi-wing footprint without throwing', async () => {
    const { facets } = await buildingFacets(cross, 'plaster', 'tile', 'gable', noVents);
    expect(facets.length).toBeGreaterThan(0);
  });

  it('roof reaches above the wall top (a ridge exists)', async () => {
    const { facets } = await buildingFacets(cross, 'plaster', 'tile', 'gable', noVents);
    const maxZ = Math.max(...facets.flatMap(f => f.pts.map(p => p[2])));
    expect(maxZ).toBeGreaterThan(1.35);   // STOREY = 1.35 wall top
  });

  it('hip roof of a single square wing peaks at one apex', async () => {
    const square: Wing[] = [{ x: 0, y: 0, w: 2, h: 2 }];
    const { facets } = await buildingFacets(square, 'plaster', 'tile', 'hip', noVents);
    const top = Math.max(...facets.flatMap(f => f.pts.map(p => p[2])));
    const apexPts = facets.flatMap(f => f.pts).filter(p => Math.abs(p[2] - top) < 1e-6);
    const xs = new Set(apexPts.map(p => p[0].toFixed(3)));
    const ys = new Set(apexPts.map(p => p[1].toFixed(3)));
    expect(xs.size).toBe(1);
    expect(ys.size).toBe(1);
  });

  it('emits a chimney (brick) whose top clears the roof ridge', async () => {
    const { facets, anchors } = await buildingFacets(
      cross, 'plaster', 'tile', 'gable',
      { vents: [{ wing: 0, t: 0.3 }] },
    );
    const brick = facets.filter(f => isMat(f.albedo, MATERIAL_RGB.brick));
    expect(brick.length).toBeGreaterThan(0);
    expect(anchors.vents).toHaveLength(1);
    // the recorded smoke anchor is above the wing's wall top + roof rise
    expect(anchors.vents[0].pos[2]).toBeGreaterThan(1.35 + 1.5 * (2 / 2));   // wallTop (STOREY=1.35) + gable rise of the h=2 nave
  });

  it('shed (mono-pitch) roof is a single slope: high ridge line at ONE edge, low at the other', async () => {
    // ridgeAxisOf({w:2,h:2}) → 'x' (slope across y); rise = SHED_SLOPE(0.5)·span(2) = 1.0,
    // high edge at y≈2 (far across-edge), low eave near the wall top at y≈0.
    const wing: Wing[] = [{ x: 0, y: 0, w: 2, h: 2, roof: 'shed' }];
    const { facets } = await buildingFacets(wing, 'plaster', 'tile', 'gable', noVents);
    const tilePts = facets.filter(f => isMat(f.albedo, MATERIAL_RGB.tile)).flatMap(f => f.pts);
    const top = Math.max(...tilePts.map(p => p[2]));
    const highLine = tilePts.filter(p => Math.abs(p[2] - top) < 1e-6);
    // The apex is a LINE (many x) at a SINGLE y — and that y is the far edge, not the
    // centre (which is what a gable ridge would be).
    const ys = new Set(highLine.map(p => p[1].toFixed(3)));
    const xs = new Set(highLine.map(p => p[0].toFixed(3)));
    expect(ys.size).toBe(1);                 // one ridge line
    expect(xs.size).toBeGreaterThan(1);      // ...running along x (not a point)
    expect(Number([...ys][0])).toBeGreaterThan(1.5);   // at the FAR edge (y≈2), not centre y=1
    // and it genuinely slopes: the high edge clears the 1.35 wall top by ~the rise.
    expect(top).toBeGreaterThan(1.35 + 0.7);
  });

  it('jetty makes the upper storey oversail the ground floor', async () => {
    const plain: Wing[] = [{ x: 0, y: 0, w: 3, h: 3, storeys: 2 }];
    const jettied: Wing[] = [{ x: 0, y: 0, w: 3, h: 3, storeys: 2, jetty: 0.4 }];
    const a = await buildingFacets(plain, 'plaster', 'tile', 'gable', noVents);
    const b = await buildingFacets(jettied, 'plaster', 'tile', 'gable', noVents);
    const maxX = (r: { facets: { pts: number[][] }[] }) => Math.max(...r.facets.flatMap(f => f.pts.map(p => p[0])));
    expect(maxX(b)).toBeGreaterThan(maxX(a));   // top storey reaches further in +x
  });

  it('derives one chimney when no features are given', async () => {
    const { anchors } = await buildingFacets(cross, 'plaster', 'tile', 'gable');
    expect(anchors.vents).toHaveLength(1);
  });

  it('eaves: the roof overhangs the wall planes and the ridge height is unchanged (v6)', async () => {
    const wing: Wing[] = [{ x: 0, y: 0, w: 3, h: 2 }];
    // thatch (Mat 'thatch') has the deepest eaves; stone keeps a flush verge.
    const { facets } = await buildingFacets(wing, 'plaster', 'thatch', 'gable', noVents);
    const roof = facets.filter(f => isMat(f.albedo, MATERIAL_RGB.thatch));
    const wallTop = 1.35;
    const maxY = Math.max(...roof.flatMap(f => f.pts.map(p => p[1])));
    const minY = Math.min(...roof.flatMap(f => f.pts.map(p => p[1])));
    expect(maxY).toBeGreaterThan(2 + 0.15);          // eave hangs past the +y wall
    expect(minY).toBeLessThan(-0.15);                // and the -y wall
    const maxX = Math.max(...roof.flatMap(f => f.pts.map(p => p[0])));
    expect(maxX).toBeGreaterThan(3 + 0.05);          // verge past the gable end (thatch ≈ 0.10)
    // ridge height identical to the flush formula: wallTop + pitch·(h/2)
    const maxZ = Math.max(...roof.flatMap(f => f.pts.map(p => p[2])));
    expect(maxZ).toBeCloseTo(wallTop + 1.5 * 1, 3);
    // the eave underside dips below the wall top (real eaves hang)
    const minRoofZ = Math.min(...roof.flatMap(f => f.pts.map(p => p[2])));
    expect(minRoofZ).toBeLessThan(wallTop);
  });

  it('stone roofs keep a flush masonry verge (no overhang past the gable ends)', async () => {
    const wing: Wing[] = [{ x: 0, y: 0, w: 3, h: 2 }];
    const { facets } = await buildingFacets(wing, 'plaster', 'stone', 'gable', noVents);
    const top = 1.35;
    const roofPts = facets.flatMap(f => f.pts).filter(p => p[2] > top - 0.2);
    const maxX = Math.max(...roofPts.map(p => p[0]));
    expect(maxX).toBeLessThanOrEqual(3 + 1e-6);      // verge = 0 on slate/stone
  });

  it('half_hip clips the gable peak (apex lower at the ends than mid-ridge)', async () => {
    const wing: Wing[] = [{ x: 0, y: 0, w: 4, h: 2, roof: 'half_hip' }];
    const gable: Wing[] = [{ x: 0, y: 0, w: 4, h: 2, roof: 'gable' }];
    const hh = await buildingFacets(wing, 'plaster', 'thatch', 'gable', noVents);
    const g = await buildingFacets(gable, 'plaster', 'thatch', 'gable', noVents);
    const ridgeAtX = (r: { facets: { pts: number[][] }[] }, x: number) =>
      Math.max(...r.facets.flatMap(f => f.pts).filter(p => Math.abs(p[0] - x) < 0.3).map(p => p[2]));
    // mid-ridge identical; the gable-end peak is clipped by the gablet
    expect(ridgeAtX(hh, 2)).toBeCloseTo(ridgeAtX(g, 2), 2);
    expect(ridgeAtX(hh, -0.05)).toBeLessThan(ridgeAtX(g, -0.05) - 0.2);
  });

  it('a dormer adds wall-material massing on the roof slope', async () => {
    const wing: Wing[] = [{ x: 0, y: 0, w: 3, h: 2 }];
    const plain = await buildingFacets(wing, 'plaster', 'tile', 'gable', noVents);
    const dormered = await buildingFacets(wing, 'plaster', 'tile', 'gable',
      { vents: [], dormers: [{ wing: 0, t: 0.5 }] });
    const wallTop = 1.35;
    const highWall = (r: { facets: { pts: number[][]; albedo: readonly number[] }[] }) =>
      r.facets.filter(f => isMat(f.albedo, MATERIAL_RGB.plaster)
        && f.pts.every(p => p[2] > wallTop + 0.05)).length;
    expect(highWall(plain)).toBe(0);
    expect(highWall(dormered)).toBeGreaterThan(0);   // dormer face rides above the wall top
  });

  it('smokehole renders as a timber ridge louvre with a cap above the ridge', async () => {
    const wing: Wing[] = [{ x: 0, y: 0, w: 3, h: 2 }];
    const { facets, anchors } = await buildingFacets(wing, 'plaster', 'thatch', 'gable',
      { vents: [{ wing: 0, t: 0.4, kind: 'smokehole' }] });
    const timber = facets.filter(f => isMat(f.albedo, MATERIAL_RGB.timber));
    expect(timber.length).toBeGreaterThan(0);
    const ridgeZ = 1.35 + 1.5 * 1;
    expect(Math.max(...timber.flatMap(f => f.pts.map(p => p[2])))).toBeGreaterThan(ridgeZ);
    expect(anchors.vents).toHaveLength(1);
  });

  it('carves an aperture recess into the wall (facet set changes vs no aperture)', async () => {
    const square: Wing[] = [{ x: 0, y: 0, w: 2, h: 2, storeys: 1 }];
    const plain = await buildingFacets(square, 'plaster', 'tile', 'gable', { vents: [] });
    const carved = await buildingFacets(square, 'plaster', 'tile', 'gable', { vents: [] }, 0,
      [{ at: [0.8, 1.7, 0], size: [0.4, 0.4, 0.85] }]);
    const facetCount = (r: { facets: unknown[] }) => r.facets.length;
    expect(facetCount(carved)).not.toBe(facetCount(plain));
  });
});
