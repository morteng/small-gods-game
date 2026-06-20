export const TICKS_PER_DAY = 240;
export const DAYS_PER_YEAR = 96;
export const SEASONS = ['spring', 'summer', 'autumn', 'winter'] as const;
export type Season = typeof SEASONS[number];

export interface CalendarTick {
  year: number;
  season: Season;
  day: number;
  dayOfYear: number;
}

export function formatCalendarTick(tick: number): CalendarTick {
  const t = Math.max(0, Math.floor(tick));
  const ticksPerYear = TICKS_PER_DAY * DAYS_PER_YEAR;
  const year = Math.floor(t / ticksPerYear) + 1;
  const dayOfYear = Math.floor((t % ticksPerYear) / TICKS_PER_DAY) + 1;
  const seasonLen = Math.floor(DAYS_PER_YEAR / SEASONS.length);
  const seasonIdx = Math.min(SEASONS.length - 1, Math.floor((dayOfYear - 1) / seasonLen));
  return {
    year,
    season: SEASONS[seasonIdx],
    day: ((dayOfYear - 1) % seasonLen) + 1,
    dayOfYear,
  };
}

export function calendarLabel(tick: number): string {
  const c = formatCalendarTick(tick);
  return `Y${c.year} ${c.season} · ${c.dayOfYear}/${DAYS_PER_YEAR}`;
}

/**
 * Night factor 0..1 for sprite emissive (lit windows): 1 at midnight, 0 at noon,
 * a smooth cosine through dawn/dusk. Pure + deterministic from the tick — the day
 * phase is `(tick mod TICKS_PER_DAY) / TICKS_PER_DAY`, with midnight at phase 0.
 */
export function nightFactorForTick(tick: number): number {
  const phase = ((Math.floor(tick) % TICKS_PER_DAY) + TICKS_PER_DAY) % TICKS_PER_DAY / TICKS_PER_DAY;
  return 0.5 + 0.5 * Math.cos(2 * Math.PI * phase);
}
