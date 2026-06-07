// tests/unit/assetgen-fit.test.ts
import { describe, it, expect } from 'vitest';
import { opaqueBounds, computeFit } from '@/assetgen/render/fit';
import { solidBox, manifoldToFacets } from '@/assetgen/geometry/solids';
import { projectFacets } from '@/assetgen/render/projection';
import { rasterize } from '@/assetgen/render/rasterize';

describe('fit', () => {
  it('opaqueBounds returns the alpha>0 box', () => {
    const d = new Uint8ClampedArray(8*8*4);
    const set = (x:number,y:number) => { d[(y*8+x)*4+3] = 255; };
    set(2,3); set(5,6);
    expect(opaqueBounds(d, 8)).toEqual({ x:2, y:3, w:4, h:4 });
  });

  it('fits a box to ~fillFrac of the frame, centred', async () => {
    const SIZE = 256, FILL = 0.88;
    const facets = manifoldToFacets((await solidBox([0,0,0], [2,2,3])).getMesh(), 'stone');
    const fit = computeFit(facets, SIZE, FILL);
    const grey = rasterize(projectFacets(facets, fit), SIZE, 'albedo');
    const b = opaqueBounds(grey, SIZE);
    const maxDim = Math.max(b.w, b.h);
    expect(maxDim).toBeGreaterThan(FILL * SIZE * 0.9);   // fills most of the frame
    expect(maxDim).toBeLessThanOrEqual(SIZE);
    expect(b.x + b.w/2).toBeGreaterThan(SIZE*0.35);       // roughly centred
    expect(b.x + b.w/2).toBeLessThan(SIZE*0.65);
  });
});
