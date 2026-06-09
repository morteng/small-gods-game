import { describe, it, expect } from 'vitest';
import { fixedFit } from '@/assetgen/render/fit';
import type { WorldFacet } from '@/assetgen/types';
import { ISO_TILE_W } from '@/render/scale-contract';

const sq: WorldFacet = {
  pts: [[0,0,0],[1,0,0],[1,1,0],[0,1,0]],
  normal: [0,0,1], albedo: [1,1,1],
} as unknown as WorldFacet;

describe('fixedFit', () => {
  it('projects at fixed scale = ISO_TILE_W/2', () => {
    const { fit } = fixedFit([sq], 4);
    expect(fit.scale).toBe(ISO_TILE_W / 2);
  });
  it('canvas holds all projected points inside [0,size]', () => {
    const { size, fit } = fixedFit([sq], 4);
    expect(size).toBeGreaterThan(0);
    for (const p of sq.pts) {
      const x = (p[0]-p[1])*fit.scale + fit.ox;
      const y = (p[0]+p[1])*(fit.scale*0.5) - p[2]*fit.scale + fit.oy;
      expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(size);
      expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(size);
    }
  });
});
