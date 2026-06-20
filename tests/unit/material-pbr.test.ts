import { describe, it, expect } from 'vitest';
import { MATERIAL_PBR, materialPbr } from '@/assetgen/material-pbr';
import { MATERIAL_RGB } from '@/assetgen/types';

describe('material PBR table', () => {
  it('covers every Mat', () => {
    for (const m of Object.keys(MATERIAL_RGB)) {
      expect(MATERIAL_PBR[m as keyof typeof MATERIAL_RGB]).toBeDefined();
    }
  });
  it('metal is metallic and smoother than thatch', () => {
    expect(materialPbr('metal').metallic).toBe(1);
    expect(materialPbr('metal').roughness).toBeLessThan(materialPbr('thatch').roughness);
  });
  it('non-emissive materials are black; glass glows warm (lit windows)', () => {
    expect(materialPbr('thatch').emissive).toEqual([0, 0, 0]);
    expect(materialPbr('stone').emissive).toEqual([0, 0, 0]);
    const glow = materialPbr('glass').emissive;
    expect(glow[0]).toBeGreaterThan(0);            // emits light
    expect(glow[0]).toBeGreaterThan(glow[2]);      // warm (R > B)
    expect(materialPbr('glass').roughness).toBeLessThan(materialPbr('door').roughness); // smooth glazing
  });
});
