import { describe, it, expect } from 'vitest';
import { composeStructure } from '@/assetgen/compose';
import { opaqueBounds } from '@/assetgen/render/fit';

// A tall-NARROW pair: height dominates the projected extent, so fit-to-box would
// squash both to ~equal opaque height, while fixed metric scale keeps the taller
// box clearly taller. This discriminates the two behaviours:
//   fixed scale -> ha=128, hb=320  (ratio 2.5; the iso footprint adds a constant
//                                   ~64px baseline to both, diluting the raw 4x)
//   fit-to-box  -> ha=901, hb=901  (ratio 1.0; both squashed to fill the same box)
// A 2.0x threshold passes the former and fails the latter.
describe('composeStructure: fixed metric scale', () => {
  it('taller building -> proportionally taller sprite (fixed scale, not squashed)', async () => {
    const a = await composeStructure({ parts: [{ prim: 'box', at: [0,0,0], size: [1,1,1] }] });
    const b = await composeStructure({ parts: [{ prim: 'box', at: [0,0,0], size: [1,1,4] }] });
    const ha = opaqueBounds(a.grey, a.size).h;
    const hb = opaqueBounds(b.grey, b.size).h;
    expect(hb).toBeGreaterThan(ha * 2.0);   // clearly taller; well above squashed (~1x)
  });
});
