// @vitest-environment node
// tests/unit/compose-pbr.test.ts
import { describe, it, expect } from 'vitest';
import { composeStructure } from '@/assetgen/compose';

describe('composeStructure PBR maps', () => {
  it('returns albedo + normal + material + emissive of equal length', async () => {
    const r = await composeStructure({ parts: [{ prim: 'box', at: [0, 0, 0], size: [2, 2, 2], material: 'stone' }] });
    const px = r.size * r.size * 4;
    expect(r.grey.length).toBe(px);
    expect(r.normal.length).toBe(px);
    expect(r.material.length).toBe(px);
    expect(r.emissive.length).toBe(px);
    const opaque = [...Array(r.size * r.size).keys()].find(i => r.grey[i * 4 + 3] === 255)!;
    expect(r.material[opaque * 4 + 3]).toBe(0); // stone metallic = 0
  });
});
