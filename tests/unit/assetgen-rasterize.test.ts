// tests/unit/assetgen-rasterize.test.ts
import { describe, it, expect } from 'vitest';
import { rasterize } from '@/assetgen/render/rasterize';
import { normalRGB } from '@/assetgen/render/projection';
import type { ScreenFacet } from '@/assetgen/types';

const quad = (x0:number,y0:number,x1:number,y1:number): { x:number;y:number }[] =>
  [{x:x0,y:y0},{x:x1,y:y0},{x:x1,y:y1},{x:x0,y:y1}];

describe('rasterize', () => {
  it('fills a facet opaque and leaves the rest transparent', () => {
    const f: ScreenFacet[] = [{ pts: quad(2,2,6,6), normal: [0,0,1], albedo: [10,20,30], depth: 0, mat: 'stone' }];
    const d = rasterize(f, 8, 'albedo');
    expect(d[(3*8+3)*4+3]).toBe(255);           // inside → opaque
    expect([d[(3*8+3)*4], d[(3*8+3)*4+1], d[(3*8+3)*4+2]]).toEqual([10,20,30]);
    expect(d[(0*8+0)*4+3]).toBe(0);             // corner → transparent
  });

  it('normal mode writes the encoded normal, not the albedo', () => {
    const f: ScreenFacet[] = [{ pts: quad(0,0,8,8), normal: [0,0,1], albedo: [10,20,30], depth: 0, mat: 'stone' }];
    const d = rasterize(f, 8, 'normal');
    const want = normalRGB([0,0,1]);
    expect([d[(4*8+4)*4], d[(4*8+4)*4+1], d[(4*8+4)*4+2]]).toEqual(want);
  });

  it('draws nearer facets over farther ones (painter order by depth)', () => {
    const f: ScreenFacet[] = [
      { pts: quad(0,0,8,8), normal: [0,0,1], albedo: [1,1,1], depth: -1, mat: 'stone' }, // far
      { pts: quad(0,0,8,8), normal: [0,0,1], albedo: [9,9,9], depth:  1, mat: 'stone' }, // near
    ];
    const d = rasterize(f, 8, 'albedo');
    expect(d[(4*8+4)*4]).toBe(9); // near wins
  });

  it('z-buffers per pixel — a tilted facet wins only where it is actually nearer', () => {
    // flat facet at constant depth 0 over the whole frame; tilted facet rising -2→+2 across x.
    const flat: ScreenFacet = { pts: quad(0,0,8,8), normal: [0,0,1], albedo: [1,1,1], depth: 0, depths: [0,0,0,0], mat: 'stone' };
    const tilt: ScreenFacet = { pts: quad(0,0,8,8), normal: [0,0,1], albedo: [9,9,9], depth: 0, depths: [-2,2,2,-2], mat: 'stone' };
    const d = rasterize([flat, tilt], 8, 'albedo');
    expect(d[(4*8+1)*4]).toBe(1); // left: tilt depth ~-1.5 < 0 → flat wins
    expect(d[(4*8+6)*4]).toBe(9); // right: tilt depth ~+1 > 0 → tilt wins
  });
});
