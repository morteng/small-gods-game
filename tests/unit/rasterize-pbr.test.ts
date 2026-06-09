// tests/unit/rasterize-pbr.test.ts
import { describe, it, expect } from 'vitest';
import { rasterizeMaps } from '@/assetgen/render/rasterize';
import type { ScreenFacet } from '@/assetgen/types';

function quad(): ScreenFacet {
  return {
    pts: [{ x: 1, y: 1 }, { x: 30, y: 1 }, { x: 30, y: 30 }, { x: 1, y: 30 }],
    normal: [0.5774, 0.5774, 0.5774], albedo: [140, 144, 150], depth: 1,
    depths: [1, 1, 1, 1], mat: 'metal',
  };
}

describe('rasterizeMaps', () => {
  it('emits albedo + material channels for covered pixels', () => {
    const size = 32;
    const m = rasterizeMaps([quad()], size);
    const i = (15 * size + 15) * 4;
    expect(m.albedo[i + 3]).toBe(255);
    expect(m.material[i + 2]).toBeGreaterThan(0); // roughness (B)
    expect(m.material[i + 3]).toBe(255);          // metallic (A) = metal → 255
  });

  it('leaves uncovered pixels transparent', () => {
    const m = rasterizeMaps([quad()], 32);
    expect(m.albedo[3]).toBe(0);
  });
});
