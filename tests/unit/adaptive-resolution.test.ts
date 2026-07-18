import { describe, it, expect } from 'vitest';
import { AdaptiveResolution } from '@/render/gpu/adaptive-resolution';

/** Feed `n` frames of `dtMs` and return the final px level. */
function feed(ar: AdaptiveResolution, dtMs: number, n: number): number {
  let px = ar.px;
  for (let i = 0; i < n; i++) px = ar.step(dtMs);
  return px;
}

// Retuned band (px1-preferred): coarsen below ~22fps (downMs≈45.45), refine at
// ~28fps (upMs≈35.71) — replacing the old 30fps/40fps bar. "sag" frame times
// below sit clearly below the 22fps coarsen floor; "recover" times sit clearly
// above the 28fps refine floor.

describe('AdaptiveResolution', () => {
  it('starts at the finest level (1:1)', () => {
    expect(new AdaptiveResolution().px).toBe(1);
  });

  it('stays at 1 while frame time is healthy (60 fps)', () => {
    const ar = new AdaptiveResolution();
    expect(feed(ar, 16.7, 300)).toBe(1);
  });

  it('climbs the ladder to the top under sustained sub-22fps load', () => {
    const ar = new AdaptiveResolution();
    // 50ms frames (20 fps) — below the 22fps floor at every level → max out at px4.
    expect(feed(ar, 50, 400)).toBe(4);
  });

  it('coarsens just one step for a mild sag, not to the top', () => {
    const ar = new AdaptiveResolution();
    // ~20.5 fps (48.7ms): below the 22fps floor but only barely — one step is
    // enough here because the test holds a constant rate (real load would re-sag
    // at px2).
    const px = feed(ar, 48.7, 60);
    expect(px).toBeGreaterThanOrEqual(2);
  });

  it('does not coarsen on a brief spike (hysteresis)', () => {
    const ar = new AdaptiveResolution();
    feed(ar, 16.7, 100);             // settle fast
    expect(feed(ar, 50, 5)).toBe(1); // a handful of slow frames must not flip it
  });

  it('clamps a giant stall spike so one frame cannot flip the level', () => {
    const ar = new AdaptiveResolution();
    feed(ar, 16.7, 100);
    expect(ar.step(100000)).toBe(1); // tab-stall spike clamped + needs sustain
  });

  it('refines all the way back to 1 once the rate recovers', () => {
    const ar = new AdaptiveResolution();
    expect(feed(ar, 50, 400)).toBe(4);   // sag → climb to the top
    expect(feed(ar, 16.7, 800)).toBe(1); // recover → refine down to 1:1
  });

  it('refines when cruising above target but inside the old dead zone', () => {
    // 30ms (~33 fps): comfortably above the 28fps refine floor. The pre-retune
    // controller treated 30–50fps as a dead band and (in a still-earlier version)
    // stuck at px4 forever; the current band coarsens <22fps / refines ≥28fps, so
    // this must refine back to 1:1.
    const ar = new AdaptiveResolution();
    expect(feed(ar, 50, 400)).toBe(4);
    expect(feed(ar, 30, 1200)).toBe(1);
  });

  it('climbs back to 1:1 despite periodic single-frame hitches', () => {
    // The real failure: 60fps steady-state with a slow frame every ~30 frames (GC,
    // a zoom-time instance repack). The old per-frame counter reset killed the
    // 90-frame climb every hitch; bleed-counters must still reach 1:1.
    const ar = new AdaptiveResolution();
    expect(feed(ar, 50, 400)).toBe(4);
    let px = ar.px;
    for (let i = 0; i < 1500; i++) px = ar.step(i % 30 === 0 ? 55 : 16.7);
    expect(px).toBe(1);
  });

  it('a clamped stall loses no refine progress', () => {
    // A tab-stall mid-climb must be ignored outright, not reset the climb.
    const ar = new AdaptiveResolution();
    feed(ar, 50, 400);                  // → px4
    feed(ar, 16.7, 50);                 // partway up the climb-back
    ar.step(100000);                    // tab stall — ignored
    expect(feed(ar, 16.7, 200)).toBe(1); // climb completes as if it never happened
  });

  it('does not flap around the boundary', () => {
    const ar = new AdaptiveResolution();
    // Alternate just-over and just-under frames; EMA should sit near neutral and
    // never accumulate enough sustained pressure to change level.
    let px = ar.px;
    for (let i = 0; i < 400; i++) px = ar.step(i % 2 === 0 ? 48 : 26);
    expect(px).toBe(1);
  });

  it('honors a custom level ladder', () => {
    const ar = new AdaptiveResolution({ levels: [1, 2, 3], downFrames: 10 });
    expect(feed(ar, 60, 500)).toBe(3); // climbs all the way under sustained load
  });

  // --- px1-preference contract (retuned band: coarsen <22fps, refine ≥28fps) ---

  it('never coarsens from px1 on a steady 25fps (40ms) stream', () => {
    // The user directive: 25fps at native 1:1 must be a stable hold, not a slide
    // toward px4. 40ms/frame is above the 22fps coarsen floor (45.45ms), so this
    // must never leave px1 — impossible to guarantee under the old 30fps bar.
    const ar = new AdaptiveResolution();
    expect(feed(ar, 40, 2000)).toBe(1);
  });

  it('refines back to 1:1 from the coarsest level under a steady ~30fps stream', () => {
    // ~30fps (33ms/frame) sits above the new 28fps refine floor, so a machine that
    // got coarsened all the way down must climb all the way back to px1. Under the
    // old 40fps refine bar this rate could never trigger a refine at all.
    const ar = new AdaptiveResolution();
    expect(feed(ar, 50, 400)).toBe(4); // start from the coarsest level
    expect(feed(ar, 33, 2000)).toBe(1);
  });
});
