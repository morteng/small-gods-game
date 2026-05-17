import { describe, it, expect } from 'vitest';
import { formatCalendarTick, TICKS_PER_DAY, DAYS_PER_YEAR } from '@/core/calendar';

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
});
