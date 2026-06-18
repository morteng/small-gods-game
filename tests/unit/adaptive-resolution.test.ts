import { describe, it, expect } from 'vitest';
import { AdaptiveResolution } from '@/render/gpu/adaptive-resolution';

/** Feed `n` frames of `dtMs` and return the final px level. */
function feed(ar: AdaptiveResolution, dtMs: number, n: number): number {
  let px = ar.px;
  for (let i = 0; i < n; i++) px = ar.step(dtMs);
  return px;
}

describe('AdaptiveResolution', () => {
  it('starts at the finest level (1:1)', () => {
    expect(new AdaptiveResolution().px).toBe(1);
  });

  it('stays at 1 while frame time is healthy (60 fps)', () => {
    const ar = new AdaptiveResolution();
    expect(feed(ar, 16.7, 300)).toBe(1);
  });

  it('coarsens to 2 after sustained sub-30fps frames', () => {
    const ar = new AdaptiveResolution();
    // 40ms frames (25 fps) — over the 33.3ms down threshold.
    expect(feed(ar, 40, 200)).toBe(2);
  });

  it('does not coarsen on a brief spike (hysteresis)', () => {
    const ar = new AdaptiveResolution();
    feed(ar, 16.7, 100);             // settle fast
    expect(feed(ar, 40, 5)).toBe(1); // a handful of slow frames must not flip it
  });

  it('clamps a giant stall spike so one frame cannot flip the level', () => {
    const ar = new AdaptiveResolution();
    feed(ar, 16.7, 100);
    expect(ar.step(100000)).toBe(1); // tab-stall spike clamped + needs sustain
  });

  it('refines back to 1 once the rate recovers', () => {
    const ar = new AdaptiveResolution();
    expect(feed(ar, 40, 200)).toBe(2);  // sag → coarsen
    expect(feed(ar, 16.7, 400)).toBe(1); // recover → refine
  });

  it('does not flap around the boundary', () => {
    const ar = new AdaptiveResolution();
    // Alternate just-over and just-under frames; EMA should sit near neutral and
    // never accumulate enough sustained pressure to change level.
    let px = ar.px;
    for (let i = 0; i < 400; i++) px = ar.step(i % 2 === 0 ? 35 : 18);
    expect(px).toBe(1);
  });

  it('honors a custom level ladder', () => {
    const ar = new AdaptiveResolution({ levels: [1, 2, 3], downFrames: 10 });
    expect(feed(ar, 50, 500)).toBe(3); // climbs all the way under sustained load
  });
});
