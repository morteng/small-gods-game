// studioNightFactor — the studio's shader-`uNight` (lit window panes) authority.
// Solar mode must agree EXACTLY with the runtime day/night path (solar hour →
// tick → nightFactorForTick), so a studio subject glows on the same schedule a
// live building would; manual az/el mode mirrors day-night.ts's elevation
// day-ness ramp (smoothstep(-5, 25, el)) so a manually-lowered sun also lights
// windows.
import { describe, it, expect } from 'vitest';
import { studioNightFactor } from '@/render/solar';
import { nightFactorForTick, tickAtSolarHour } from '@/core/calendar';

describe('studioNightFactor', () => {
  it('solar mode matches the runtime authority across the whole day', () => {
    for (let h = 0; h < 24; h += 0.5) {
      expect(studioNightFactor('solar', h, /* el ignored */ 0))
        .toBe(nightFactorForTick(tickAtSolarHour(h)));
    }
  });

  it('solar mode: full night at midnight, full day at noon (windows glow when they should)', () => {
    expect(studioNightFactor('solar', 0, 0)).toBe(1);
    expect(studioNightFactor('solar', 12, 0)).toBe(0);
  });

  it('manual mode: ramp endpoints mirror day-night.ts (night ≤ −5°, day ≥ 25°)', () => {
    expect(studioNightFactor('manual', 12, -5)).toBe(1);   // sun below horizon → glow
    expect(studioNightFactor('manual', 12, -30)).toBe(1);
    expect(studioNightFactor('manual', 12, 25)).toBe(0);   // sun well up → no glow
    expect(studioNightFactor('manual', 12, 60)).toBe(0);
    // hour must be irrelevant in manual mode (no tick to read)
    expect(studioNightFactor('manual', 0, 60)).toBe(0);
  });

  it('manual mode: monotonically non-increasing as the sun rises through the ramp', () => {
    let prev = Infinity;
    for (let el = -10; el <= 30; el += 1) {
      const n = studioNightFactor('manual', 12, el);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(prev);
      prev = n;
    }
    // and it's a real ramp, not a step: dusk elevations glow partially
    const mid = studioNightFactor('manual', 12, 10);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
  });
});
