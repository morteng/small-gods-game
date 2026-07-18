import { describe, it, expect } from 'vitest';
import {
  formatCalendarTick, nightFactorForTick, solarHourForTick, tickAtSolarHour,
  TICKS_PER_DAY, DAYS_PER_YEAR, TICKS_PER_SOLAR_DAY, SOLAR_START_HOUR,
  WORLD_START_HOUR,
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

  describe('solar day (day/night cycle)', () => {
    it('IS the calendar day (1:1 realtime) and boots mid-morning without an anchor', () => {
      expect(TICKS_PER_SOLAR_DAY).toBe(TICKS_PER_DAY);           // one coherent clock
      expect(TICKS_PER_DAY).toBe(86_400 * 60);                   // 24 real hours at 60 ticks/s
      expect(solarHourForTick(0)).toBeCloseTo(SOLAR_START_HOUR, 6); // fixed-hour fallback
    });
    it('tickAtSolarHour inverts solarHourForTick', () => {
      for (const h of [0, 3, 6, 9, 12, 15, 18, 21]) {
        expect(solarHourForTick(tickAtSolarHour(h))).toBeCloseTo(h, 4);
      }
      expect(tickAtSolarHour(SOLAR_START_HOUR)).toBe(0);
    });
    it('fresh worlds anchor to a fixed 08:00 morning (never the wall clock)', () => {
      expect(WORLD_START_HOUR).toBe(8);
      expect(solarHourForTick(tickAtSolarHour(WORLD_START_HOUR))).toBeCloseTo(8, 4);
      expect(nightFactorForTick(tickAtSolarHour(WORLD_START_HOUR))).toBeCloseTo(0, 3);
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
      // Timescale-aware step (~240 samples per half-day) — a fixed 60-tick step
      // would be 86,400 iterations over the true 24 h solar day.
      const step = TICKS_PER_SOLAR_DAY / 480;
      let prev = nightFactorForTick(midnight);
      for (let t = midnight; t <= midnight + half; t += step) {
        const n = nightFactorForTick(t);
        expect(n).toBeGreaterThanOrEqual(0);
        expect(n).toBeLessThanOrEqual(1);
        expect(n).toBeLessThanOrEqual(prev + 1e-9); // falling toward noon
        prev = n;
      }
      for (let t = midnight + half; t <= midnight + TICKS_PER_SOLAR_DAY; t += step) {
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
