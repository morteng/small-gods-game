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

  it('climbs the ladder to the top under sustained sub-30fps load', () => {
    const ar = new AdaptiveResolution();
    // 40ms frames (25 fps) — below the 30fps goal at every level → max out at px4.
    expect(feed(ar, 40, 400)).toBe(4);
  });

  it('coarsens just one step for a mild sag, not to the top', () => {
    const ar = new AdaptiveResolution();
    // ~28 fps (35.7ms): below the 30fps goal but only barely — one step is enough
    // here because the test holds a constant rate (real load would re-sag at px2).
    const px = feed(ar, 35.7, 60);
    expect(px).toBeGreaterThanOrEqual(2);
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

  it('refines all the way back to 1 once the rate recovers', () => {
    const ar = new AdaptiveResolution();
    expect(feed(ar, 40, 400)).toBe(4);   // sag → climb to the top
    expect(feed(ar, 16.7, 800)).toBe(1); // recover → refine down to 1:1
  });

  it('refines when cruising above target but inside the old dead zone', () => {
    // ~45 fps (22ms): comfortably above the 30fps target with real headroom. The
    // old controller treated 30–50fps as a dead band and stuck at px4 forever; the
    // new band is 30–40fps so this must refine back to 1:1.
    const ar = new AdaptiveResolution();
    expect(feed(ar, 40, 400)).toBe(4);
    expect(feed(ar, 22, 1200)).toBe(1);
  });

  it('climbs back to 1:1 despite periodic single-frame hitches', () => {
    // The real failure: 60fps steady-state with a slow frame every ~30 frames (GC,
    // a zoom-time instance repack). The old per-frame counter reset killed the
    // 90-frame climb every hitch; bleed-counters must still reach 1:1.
    const ar = new AdaptiveResolution();
    expect(feed(ar, 40, 400)).toBe(4);
    let px = ar.px;
    for (let i = 0; i < 1500; i++) px = ar.step(i % 30 === 0 ? 45 : 16.7);
    expect(px).toBe(1);
  });

  it('a clamped stall loses no refine progress', () => {
    // A tab-stall mid-climb must be ignored outright, not reset the climb.
    const ar = new AdaptiveResolution();
    feed(ar, 40, 400);                  // → px4
    feed(ar, 16.7, 50);                 // partway up the climb-back
    ar.step(100000);                    // tab stall — ignored
    expect(feed(ar, 16.7, 200)).toBe(1); // climb completes as if it never happened
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
