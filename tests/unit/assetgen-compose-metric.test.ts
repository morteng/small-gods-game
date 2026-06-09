import { describe, it, expect } from 'vitest';
import { composeStructure } from '@/assetgen/compose';
import { opaqueBounds } from '@/assetgen/render/fit';

// Two same-footprint boxes of different height must render at the SAME px-per-unit:
// the 2-unit-tall box's opaque height must be clearly greater than the 1-unit box's
// (fixed metric scale, not fit-to-box which would squash both to ~equal).
describe('composeStructure: fixed metric scale', () => {
  it('taller building -> proportionally taller sprite', async () => {
    const a = await composeStructure({ parts: [{ prim: 'box', at: [0,0,0], size: [2,2,1] }] });
    const b = await composeStructure({ parts: [{ prim: 'box', at: [0,0,0], size: [2,2,2] }] });
    const ha = opaqueBounds(a.grey, a.size).h;
    const hb = opaqueBounds(b.grey, b.size).h;
    expect(hb).toBeGreaterThan(ha * 1.3);
  });
});
