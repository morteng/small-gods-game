import { describe, it, expect } from 'vitest';
import {
  coverageFor, descentCameraOffsetPx, ascentResetDue, DESCENT_CAMERA_OFFSET_PX,
} from '@/game/sky-transition';

// UI v3 sky/cloud transition spike — the pure curves + the pure "is the
// ascent's reset due" decision. No Shell, no Game, no clock: every input is an
// explicit argument, so these are the load-bearing sequencing guarantees
// tested at the cheapest possible level.
describe('sky-transition — pure curves', () => {
  it('descent COVERAGE starts fully covered and ends fully revealed', () => {
    expect(coverageFor('descent', 0)).toBe(1);
    expect(coverageFor('descent', 1)).toBe(0);
    // monotonically non-increasing across the sweep
    const samples = [0, 0.25, 0.5, 0.75, 1].map((p) => coverageFor('descent', p));
    for (let i = 1; i < samples.length; i++) expect(samples[i]).toBeLessThanOrEqual(samples[i - 1]);
  });

  it('ascent COVERAGE starts fully revealed and ends fully covered', () => {
    expect(coverageFor('ascent', 0)).toBe(0);
    expect(coverageFor('ascent', 1)).toBe(1);
    const samples = [0, 0.25, 0.5, 0.75, 1].map((p) => coverageFor('ascent', p));
    for (let i = 1; i < samples.length; i++) expect(samples[i]).toBeGreaterThanOrEqual(samples[i - 1]);
  });

  it('coverage stays in 0..1 for out-of-range phase (defensive clamp)', () => {
    expect(coverageFor('descent', -1)).toBeLessThanOrEqual(1);
    expect(coverageFor('descent', -1)).toBeGreaterThanOrEqual(0);
    expect(coverageFor('ascent', 2)).toBeLessThanOrEqual(1);
    expect(coverageFor('ascent', 2)).toBeGreaterThanOrEqual(0);
  });

  it('the descent camera offset starts a few hundred px high and eases to 0', () => {
    expect(descentCameraOffsetPx(0)).toBe(DESCENT_CAMERA_OFFSET_PX);
    expect(descentCameraOffsetPx(1)).toBe(0);
    // ease-OUT: most of the distance is covered EARLY, not late (the derivative
    // shrinks as phase grows) — the back half moves less than the front half.
    const front = descentCameraOffsetPx(0) - descentCameraOffsetPx(0.5);
    const back = descentCameraOffsetPx(0.5) - descentCameraOffsetPx(1);
    expect(front).toBeGreaterThan(back);
  });
});

describe('sky-transition — ascentResetDue (the reset-sequencing guarantee)', () => {
  it('a descent never fires the reset, at any phase', () => {
    expect(ascentResetDue('descent', 0, false)).toBe(false);
    expect(ascentResetDue('descent', 1, false)).toBe(false);
    expect(ascentResetDue(null, 1, false)).toBe(false);
  });

  it('an ascent fires the reset only once phase reaches 1', () => {
    expect(ascentResetDue('ascent', 0, false)).toBe(false);
    expect(ascentResetDue('ascent', 0.99, false)).toBe(false);
    expect(ascentResetDue('ascent', 1, false)).toBe(true);
  });

  it('does not re-fire once already fired — completion implies exactly ONE reset', () => {
    expect(ascentResetDue('ascent', 1, true)).toBe(false);
  });

  it('click-to-skip forces it: skip only jumps the PHASE to 1, and this function reacts identically to a phase of 1 reached naturally or by a skip', () => {
    // Skipping is modelled as "phase already reads 1" (see shell-state.ts's
    // `skipTransition` — it rewinds startedAtMs so transitionPhase reads 1 as
    // of `nowMs`), so there is no separate "was this a skip" branch to test:
    // this call is byte-identical whether phase 1 arrived by the clock or by
    // a skip.
    expect(ascentResetDue('ascent', 1, false)).toBe(true);
  });
});
