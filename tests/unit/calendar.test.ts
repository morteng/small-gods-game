import { describe, it, expect } from 'vitest';
import {
  formatCalendarTick, nightFactorForTick, solarHourForTick, tickAtSolarHour,
  TICKS_PER_DAY, DAYS_PER_YEAR, TICKS_PER_SOLAR_DAY, SOLAR_START_HOUR,
} from '@/core/calendar';

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

  describe('solar day (visual day/night cycle)', () => {
    it('spans many calendar days and boots mid-morning', () => {
      expect(TICKS_PER_SOLAR_DAY % TICKS_PER_DAY).toBe(0);
      expect(TICKS_PER_SOLAR_DAY / TICKS_PER_DAY).toBeGreaterThanOrEqual(30); // no 4-second strobe day
      expect(solarHourForTick(0)).toBeCloseTo(SOLAR_START_HOUR, 6);
    });
    it('tickAtSolarHour inverts solarHourForTick', () => {
      for (const h of [0, 3, 6, 9, 12, 15, 18, 21]) {
        expect(solarHourForTick(tickAtSolarHour(h))).toBeCloseTo(h, 4);
      }
      expect(tickAtSolarHour(SOLAR_START_HOUR)).toBe(0);
    });
  });

  describe('nightFactorForTick (lit-window glow)', () => {
    const midnight = tickAtSolarHour(0);
    const noon = tickAtSolarHour(12);

    it('is full (1) at solar midnight and zero at solar noon', () => {
      expect(nightFactorForTick(midnight)).toBeCloseTo(1, 6);
      expect(nightFactorForTick(noon)).toBeCloseTo(0, 6);
      expect(nightFactorForTick(midnight + TICKS_PER_SOLAR_DAY)).toBeCloseTo(1, 6); // next midnight
    });
    it('plateaus: full glow deep at night, none through the working day', () => {
      expect(nightFactorForTick(tickAtSolarHour(22))).toBeCloseTo(1, 6);  // deep night
      expect(nightFactorForTick(tickAtSolarHour(2))).toBeCloseTo(1, 6);
      expect(nightFactorForTick(tickAtSolarHour(9))).toBeCloseTo(0, 6);   // morning
      expect(nightFactorForTick(tickAtSolarHour(16))).toBeCloseTo(0, 6);  // afternoon
    });
    it('ramps monotonically midnight→noon and noon→midnight, within 0..1', () => {
      const half = TICKS_PER_SOLAR_DAY / 2;
      let prev = nightFactorForTick(midnight);
      for (let t = midnight; t <= midnight + half; t += 60) {
        const n = nightFactorForTick(t);
        expect(n).toBeGreaterThanOrEqual(0);
        expect(n).toBeLessThanOrEqual(1);
        expect(n).toBeLessThanOrEqual(prev + 1e-9); // falling toward noon
        prev = n;
      }
      for (let t = midnight + half; t <= midnight + TICKS_PER_SOLAR_DAY; t += 60) {
        const n = nightFactorForTick(t);
        expect(n).toBeGreaterThanOrEqual(prev - 1e-9); // rising toward midnight
        prev = n;
      }
    });
    it('lamps come on around dusk (partial at sunset, full soon after)', () => {
      const sunset = nightFactorForTick(tickAtSolarHour(18));
      expect(sunset).toBeGreaterThan(0.1);
      expect(sunset).toBeLessThan(0.9);
      expect(nightFactorForTick(tickAtSolarHour(20))).toBeCloseTo(1, 3);
    });
    it('is periodic over the solar day and ignores the integer-tick fraction', () => {
      expect(nightFactorForTick(123 + TICKS_PER_SOLAR_DAY)).toBeCloseTo(nightFactorForTick(123), 6);
      expect(nightFactorForTick(50.9)).toBeCloseTo(nightFactorForTick(50), 6);
    });
  });
});
