import { describe, it, expect } from 'vitest';
import {
  tierFor, stepFading, isSilenced, FADED_ACTIONS,
  SMALL_IN, SMALL_OUT, CULT_IN, CULT_OUT, MAJOR_IN, MAJOR_OUT,
  FADE_MASS, FADE_SUSTAIN_TICKS,
  type GodTier,
} from '@/sim/god-tier';
import { TICKS_PER_DAY } from '@/core/calendar';

describe('tierFor — the ladder', () => {
  it('places the calibration anchors on the tiers the spec claims', () => {
    // Measured from the shipped default world: 6 believers at faith .40 / U .10
    // / D .15 → mass 3.744. Act 1 is a handful of fickle believers: `small`.
    expect(tierFor(3.744)).toBe('small');
    // One small settlement (36 souls) converted at moderate depth (.5/.3/.4):
    // 36 × 0.5·1.6·1.8 = 51.84.
    expect(tierFor(51.84)).toBe('cult');
    // Two-to-three settlements (144 souls) at the same depth.
    expect(tierFor(207.36)).toBe('major');
    // A broad, shallow, hollow church (432 souls at .5/.2/.2).
    expect(tierFor(423.36)).toBe('major');
    // Nothing at all.
    expect(tierFor(0)).toBe('nameless');
  });

  it('is total: non-finite and negative mass read as nothing', () => {
    // A corrupted mass must never CROWN a god — `Infinity` reads as nothing, the
    // same safe default `stepFading` takes when it treats non-finite as starving.
    for (const bad of [NaN, Infinity, -Infinity, -5]) {
      expect(tierFor(bad)).toBe('nameless');
      expect(tierFor(bad, 'major')).toBe('nameless');
    }
  });

  it('uses the IN edges on a cold read (no previous tier)', () => {
    expect(tierFor(SMALL_IN)).toBe('small');
    expect(tierFor(SMALL_IN - 1e-9)).toBe('nameless');
    expect(tierFor(CULT_IN)).toBe('cult');
    expect(tierFor(CULT_IN - 1e-9)).toBe('small');
    expect(tierFor(MAJOR_IN)).toBe('major');
    expect(tierFor(MAJOR_IN - 1e-9)).toBe('cult');
  });

  it('holds ground down to the OUT edge (hysteresis), then drops', () => {
    // Inside each dead-zone the answer depends on where you came from.
    expect(tierFor(CULT_OUT + 1, 'cult')).toBe('cult');     // keeping it
    expect(tierFor(CULT_OUT + 1, 'small')).toBe('small');   // not yet earned
    expect(tierFor(CULT_OUT - 1e-9, 'cult')).toBe('small'); // lost it
    expect(tierFor(MAJOR_OUT + 1, 'major')).toBe('major');
    expect(tierFor(MAJOR_OUT + 1, 'cult')).toBe('cult');
    expect(tierFor(SMALL_OUT + 1e-9, 'small')).toBe('small');
    expect(tierFor(SMALL_OUT - 1e-9, 'small')).toBe('nameless');
  });

  it('drops a major god straight past an emptied dead-zone', () => {
    // Falling from `major` to below the cult OUT edge must land on `small`, not
    // stick at `cult` — each rung is evaluated against the rank actually held.
    expect(tierFor(CULT_OUT - 1, 'major')).toBe('small');
    expect(tierFor(0, 'major')).toBe('nameless');
  });

  it('never flickers: a slow sweep up then down changes tier monotonically', () => {
    const STEP = 0.37;   // deliberately not a divisor of any edge
    let tier: GodTier = 'nameless';
    const up: GodTier[] = [];
    for (let m = 0; m <= 260; m += STEP) {
      const next = tierFor(m, tier);
      if (next !== tier) up.push(next);
      tier = next;
    }
    expect(up).toEqual(['small', 'cult', 'major']);

    const down: GodTier[] = [];
    for (let m = 260; m >= 0; m -= STEP) {
      const next = tierFor(m, tier);
      if (next !== tier) down.push(next);
      tier = next;
    }
    expect(down).toEqual(['cult', 'small', 'nameless']);
  });

  it('the up and down paths differ ONLY inside the dead-zones', () => {
    for (let m = 0; m <= 260; m += 0.25) {
      const rising = tierFor(m, tierFor(m - 0.25, 'nameless') === 'nameless' ? 'nameless' : 'major');
      void rising;
      const asClimber = tierFor(m, 'nameless');
      const asFaller = tierFor(m, 'major');
      const inDeadZone =
        (m >= SMALL_OUT && m < SMALL_IN) ||
        (m >= CULT_OUT && m < CULT_IN) ||
        (m >= MAJOR_OUT && m < MAJOR_IN);
      if (!inDeadZone) expect(asClimber).toBe(asFaller);
    }
  });
});

describe('stepFading — the god lifecycle', () => {
  it('measures the window in whole game days, never raw ticks', () => {
    expect(FADE_SUSTAIN_TICKS % TICKS_PER_DAY).toBe(0);
    expect(FADE_SUSTAIN_TICKS / TICKS_PER_DAY).toBe(2);
  });

  it('starts the clock on the first tick below the line', () => {
    const r = stepFading({}, FADE_MASS - 0.01, 1000);
    expect(r.belowSinceTick).toBe(1000);
    expect(r.faded).toBe(false);
    expect(r.transition).toBeNull();
  });

  it('does NOT fade one tick short of the window, and DOES at it', () => {
    const start = 500;
    const nearly = stepFading({ belowSinceTick: start }, 0, start + FADE_SUSTAIN_TICKS - 1);
    expect(nearly.faded).toBe(false);
    expect(nearly.transition).toBeNull();

    const at = stepFading({ belowSinceTick: start }, 0, start + FADE_SUSTAIN_TICKS);
    expect(at.faded).toBe(true);
    expect(at.transition).toBe('faded');
  });

  it('reports the fade transition only once', () => {
    const start = 0;
    const first = stepFading({ belowSinceTick: start }, 0, FADE_SUSTAIN_TICKS);
    expect(first.transition).toBe('faded');
    const later = stepFading(
      { belowSinceTick: start, faded: true }, 0, FADE_SUSTAIN_TICKS + 9999,
    );
    expect(later.faded).toBe(true);
    expect(later.transition).toBeNull();
  });

  it('clears pressure the moment mass recovers, before the window closes', () => {
    const r = stepFading({ belowSinceTick: 10 }, FADE_MASS, 20);
    expect(r.belowSinceTick).toBeUndefined();
    expect(r.faded).toBe(false);
    expect(r.transition).toBeNull();   // never faded, so nothing "returned"
  });

  it('returns a faded god when belief comes back', () => {
    const r = stepFading({ belowSinceTick: 0, faded: true }, FADE_MASS + 1, 999);
    expect(r.faded).toBe(false);
    expect(r.belowSinceTick).toBeUndefined();
    expect(r.transition).toBe('returned');
  });

  it('treats a non-finite mass as starving rather than as safety', () => {
    expect(stepFading({ belowSinceTick: 0 }, NaN, FADE_SUSTAIN_TICKS).faded).toBe(true);
  });
});

describe('isSilenced — what a faded god keeps', () => {
  it('leaves an unfaded god entirely alone', () => {
    for (const a of ['whisper', 'omen', 'dream', 'miracle', 'answer_prayer', 'smite', 'summon_storm']) {
      expect(isSilenced({}, a)).toBe(false);
      expect(isSilenced({ faded: false }, a)).toBe(false);
    }
  });

  it('keeps the whisper — the primal channel, and the only route back', () => {
    expect(isSilenced({ faded: true }, 'whisper')).toBe(false);
    expect(FADED_ACTIONS.has('whisper')).toBe(true);
  });

  it('silences everything else', () => {
    for (const a of ['omen', 'dream', 'miracle', 'answer_prayer', 'smite', 'summon_storm']) {
      expect(isSilenced({ faded: true }, a)).toBe(true);
    }
  });
});
