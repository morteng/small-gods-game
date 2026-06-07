// tests/unit/assetgen-primitives.test.ts
import { describe, it, expect } from 'vitest';
import { box } from '@/assetgen/geometry/primitives';

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
