// tests/unit/assetgen-primitives.test.ts
import { describe, it, expect } from 'vitest';
import { box, extrudeNgon, cylinder, prism, cone, ellipsoid, arch } from '@/assetgen/geometry/primitives';
import { frontFacing, normalize } from '@/assetgen/render/projection';

describe('box primitive', () => {
  it('emits exactly the 3 camera-facing faces (top, +x, +y)', () => {
    const f = box([0,0,0], [1,1,1], 'stone');
    expect(f).toHaveLength(3);
    const normals = f.map(x => x.normal);
    expect(normals).toContainEqual([0,0,1]);
    expect(normals).toContainEqual([1,0,0]);
    expect(normals).toContainEqual([0,1,0]);
  });

  it('shades the top brightest and the +y wall darkest', () => {
    const f = box([0,0,0], [2,2,3], 'stone');
    const top = f.find(x => x.normal[2] === 1)!.albedo[0];
    const fx  = f.find(x => x.normal[0] === 1)!.albedo[0];
    const fy  = f.find(x => x.normal[1] === 1)!.albedo[0];
    expect(top).toBeGreaterThan(fx);
    expect(fx).toBeGreaterThan(fy);
  });

  it('places faces at the given min-corner and size', () => {
    const f = box([2,3,0], [1,1,4], 'stone');
    const top = f.find(x => x.normal[2] === 1)!;
    for (const p of top.pts) expect(p[2]).toBe(4); // top at base+height
  });
});

describe('extruded solids', () => {
  it('cylinder emits one quad per side plus a top cap', () => {
    const f = cylinder([0,0], 0, 1, 2, 'stone', 12);
    expect(f).toHaveLength(12 + 1);
    expect(f.some(x => x.normal[0] === 0 && x.normal[1] === 0 && x.normal[2] === 1)).toBe(true); // top cap
  });

  it('cone tapers to an apex (triangles, no top cap)', () => {
    const f = cone([0,0], 0, 1, 2, 'foliage', 8);
    expect(f).toHaveLength(8);                          // 8 triangular faces, no cap
    for (const face of f) expect(face.pts).toHaveLength(3);
  });

  it('prism honours its side count', () => {
    expect(prism([0,0], 0, 1, 1, 6, 'stone')).toHaveLength(6 + 1);
  });

  it('every side has at least one camera-facing facet (front + back split)', () => {
    const f = extrudeNgon([0,0], 0, 1, 1, 2, 16, 'stone');
    expect(f.some(x => frontFacing(x.normal))).toBe(true);
  });
});

describe('ellipsoid + arch', () => {
  it('ellipsoid tessellates into segU*segV quads with finite normals', () => {
    const f = ellipsoid([0,0], 0, [1,1,1], 'foliage', 12, 8);
    expect(f).toHaveLength(12 * 8);
    for (const face of f) {
      const n = normalize(face.normal);
      expect(Number.isFinite(n[0] + n[1] + n[2])).toBe(true);
    }
  });

  it('arch is two uprights + a lintel (3 boxes => 9 facets)', () => {
    const f = arch([0,0,0], 3, 4, 0.5, 'stone');
    expect(f).toHaveLength(9); // each box = 3 visible facets
    const maxZ = Math.max(...f.flatMap(x => x.pts.map(p => p[2])));
    expect(maxZ).toBeCloseTo(4 + 0.5); // lintel sits atop the posts
  });
});
