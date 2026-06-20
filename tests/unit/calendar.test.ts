import { describe, it, expect } from 'vitest';
import { formatCalendarTick, nightFactorForTick, TICKS_PER_DAY, DAYS_PER_YEAR } from '@/core/calendar';

describe('calendar', () => {
  it('formats tick 0 as year 1, spring, day 1', () => {
    expect(formatCalendarTick(0)).toEqual({ year: 1, season: 'spring', day: 1, dayOfYear: 1 });
  });

  it('formats one full year later as year 2, spring, day 1', () => {
    const ticksPerYear = TICKS_PER_DAY * DAYS_PER_YEAR;
    expect(formatCalendarTick(ticksPerYear).year).toBe(2);
    expect(formatCalendarTick(ticksPerYear).season).toBe('spring');
    expect(formatCalendarTick(ticksPerYear).day).toBe(1);
  });

  it('formats mid-summer correctly', () => {
    const ticksPerYear = TICKS_PER_DAY * DAYS_PER_YEAR;
    const result = formatCalendarTick(Math.floor(ticksPerYear * 0.3));
    expect(result.season).toBe('summer');
  });

  describe('nightFactorForTick (lit-window glow)', () => {
    it('is full (1) at midnight and zero at noon', () => {
      expect(nightFactorForTick(0)).toBeCloseTo(1, 6);                       // midnight = day phase 0
      expect(nightFactorForTick(TICKS_PER_DAY / 2)).toBeCloseTo(0, 6);       // noon
      expect(nightFactorForTick(TICKS_PER_DAY)).toBeCloseTo(1, 6);           // next midnight
    });
    it('is half-lit at dawn/dusk and stays within 0..1', () => {
      expect(nightFactorForTick(TICKS_PER_DAY / 4)).toBeCloseTo(0.5, 6);     // dawn
      expect(nightFactorForTick((TICKS_PER_DAY * 3) / 4)).toBeCloseTo(0.5, 6); // dusk
      for (let t = 0; t < TICKS_PER_DAY * 2; t += 7) {
        const n = nightFactorForTick(t);
        expect(n).toBeGreaterThanOrEqual(0);
        expect(n).toBeLessThanOrEqual(1);
      }
    });
    it('is periodic over the day and ignores the integer-tick fraction', () => {
      expect(nightFactorForTick(123 + TICKS_PER_DAY)).toBeCloseTo(nightFactorForTick(123), 6);
      expect(nightFactorForTick(50.9)).toBeCloseTo(nightFactorForTick(50), 6);
    });
  });
});
