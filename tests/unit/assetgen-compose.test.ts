// tests/unit/assetgen-compose.test.ts
import { describe, it, expect } from 'vitest';
import { composeStructure, type StructureSpec } from '@/assetgen/compose';

describe('composeStructure', () => {
  const spec: StructureSpec = {
    size: 256,
    parts: [
      { prim: 'box', at: [0,0,0], size: [2,2,2], material: 'stone' },
      { prim: 'cone', center: [1,1], baseZ: 2, radius: 1.2, height: 2, material: 'thatch' },
    ],
  };

  it('returns grey + normal buffers of the requested size', async () => {
    const r = await composeStructure(spec);
    expect(r.size).toBe(256);
    expect(r.grey).toHaveLength(256*256*4);
    expect(r.normal).toHaveLength(256*256*4);
  });

  it('grey and normal share the exact same opaque mask (pixel-aligned)', async () => {
    const r = await composeStructure(spec);
    let mismatches = 0;
    for (let i = 3; i < r.grey.length; i += 4) {
      if ((r.grey[i] > 0) !== (r.normal[i] > 0)) mismatches++;
    }
    expect(mismatches).toBe(0);
  });

  it('reports a non-empty bbox inside the frame', async () => {
    const r = await composeStructure(spec);
    expect(r.bbox.w).toBeGreaterThan(0);
    expect(r.bbox.h).toBeGreaterThan(0);
    expect(r.bbox.x + r.bbox.w).toBeLessThanOrEqual(256);
    expect(r.bbox.y + r.bbox.h).toBeLessThanOrEqual(256);
  });

  it('composes a primitive box spec into aligned grey+normal buffers', async () => {
    const res = await composeStructure({ size: 128, parts: [{ prim: 'box', at: [0,0,0], size: [1,1,1] }] });
    expect(res.size).toBe(128);
    let greyOpaque = 0, normalOpaque = 0, mismatch = 0;
    for (let i = 3; i < res.grey.length; i += 4) {
      const g = res.grey[i] > 0, n = res.normal[i] > 0;
      if (g) greyOpaque++; if (n) normalOpaque++; if (g !== n) mismatch++;
    }
    expect(greyOpaque).toBeGreaterThan(0);
    expect(mismatch).toBe(0);
  });
});
