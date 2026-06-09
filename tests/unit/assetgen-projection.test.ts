// tests/unit/assetgen-projection.test.ts
import { describe, it, expect } from 'vitest';
import { project, normalRGB, frontFacing, projectFacets, viewDepth } from '@/assetgen/render/projection';
import type { WorldFacet } from '@/assetgen/types';

describe('projection', () => {
  it('projects the origin to the screen origin', () => {
    const p = project([0,0,0], { scale: 10, ox: 100, oy: 50 });
    expect(p).toEqual({ x: 100, y: 50 });
  });

  it('moving +x and +y in tile space separates / lowers on screen', () => {
    const s = { scale: 10, ox: 0, oy: 0 };
    expect(project([1,0,0], s).x).toBeGreaterThan(project([0,1,0], s).x); // +x is screen-right of +y
    expect(project([1,1,0], s).y).toBeGreaterThan(project([0,0,0], s).y); // depth lowers on screen
    expect(project([0,0,1], s).y).toBeLessThan(project([0,0,0], s).y);    // height raises on screen
  });

  it('encodes the up-normal with a high green (screen-up) channel', () => {
    const top = normalRGB([0,0,1]);
    expect(top[1]).toBeGreaterThan(200); // G = screen-up dominant for a roof/top face
  });

  it('culls back-facing facets and keeps front-facing ones', () => {
    expect(frontFacing([1,0,0])).toBe(true);
    expect(frontFacing([-1,0,0])).toBe(false);
    const facets: WorldFacet[] = [
      { pts: [[0,0,0],[1,0,0],[1,0,1]], normal: [0,-1,0], albedo: [1,1,1], mat: 'stone' }, // back face
      { pts: [[0,0,0],[1,0,0],[1,0,1]], normal: [0,1,0],  albedo: [1,1,1], mat: 'stone' }, // front face
    ];
    expect(projectFacets(facets, { scale: 1, ox: 0, oy: 0 })).toHaveLength(1);
  });

  it('keys depth by mean view-depth (nearer = larger)', () => {
    expect(viewDepth([1,1,1])).toBeGreaterThan(viewDepth([0,0,0]));
  });
});
