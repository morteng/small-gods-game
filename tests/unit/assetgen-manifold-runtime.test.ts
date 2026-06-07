import { describe, it, expect } from 'vitest';
import { getManifold } from '@/assetgen/geometry/manifold-runtime';

describe('getManifold', () => {
  it('initialises the wasm module and exposes Manifold', async () => {
    const m = await getManifold();
    expect(typeof m.Manifold.cube).toBe('function');
    const box = m.Manifold.cube([2, 3, 4]);
    const bb = box.boundingBox();
    expect(bb.min).toEqual([0, 0, 0]);
    expect(bb.max[0]).toBeCloseTo(2, 5);
    expect(bb.max[2]).toBeCloseTo(4, 5);
  });

  it('returns the same cached instance on repeated calls', async () => {
    const a = await getManifold();
    const b = await getManifold();
    expect(a).toBe(b);
  });
});
