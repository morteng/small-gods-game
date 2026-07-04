import { smoothstep } from '@/core/math';

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

/* ── The visual solar day (day/night cycle) ────────────────────────────────
 *
 * The VISUAL solar day is deliberately much longer than the calendar day: at the
 * base sim rate a 240-tick calendar day lasts ~4 real seconds (the sim compresses
 * days into heartbeats — mortality fires once per 4 s "day"), so sweeping the sun
 * once per calendar day would strobe. The original nightFactor wiring was reverted
 * for exactly that ("every window blinked on/off"). Instead one sunrise-to-sunrise
 * sweep spans SOLAR_DAY_CALENDAR_DAYS calendar days (~4 real minutes at rate 1,
 * ~30 s at the 8× fast-forward). Still a pure function of the tick — deterministic,
 * scrub-safe, and save/replay-stable. */
export const SOLAR_DAY_CALENDAR_DAYS = 60;
export const TICKS_PER_SOLAR_DAY = TICKS_PER_DAY * SOLAR_DAY_CALENDAR_DAYS;
/** Solar hour at tick 0 — a fresh world boots mid-morning, not in the dark. */
export const SOLAR_START_HOUR = 9;

/** Hour-of-day (0..24, 0 = solar midnight) of the VISUAL solar day at `tick`. */
export function solarHourForTick(tick: number): number {
  const phase = (((Math.floor(tick) / TICKS_PER_SOLAR_DAY) % 1) + 1) % 1;
  return (phase * 24 + SOLAR_START_HOUR) % 24;
}

/** First tick ≥ 0 whose solar hour is `hour` — dev/test convenience for forcing
 *  the clock to noon/midnight (`clock.setNow(tickAtSolarHour(0))`). */
export function tickAtSolarHour(hour: number): number {
  const h = ((hour % 24) + 24) % 24;
  return Math.round((((h - SOLAR_START_HOUR + 24) % 24) / 24) * TICKS_PER_SOLAR_DAY);
}

/**
 * Night factor 0..1 — drives the sprite emissive (lit window panes, shader
 * `emissive × uNight`) and anchors the day/night lighting ramp: 1 deep night,
 * 0 full day, smooth ramps through dusk/dawn (lamps light around sunset ~18:00,
 * go dark after sunrise ~6:00), computed on the VISUAL solar day (see
 * TICKS_PER_SOLAR_DAY above). Pure + deterministic from the tick.
 */
export function nightFactorForTick(tick: number): number {
  const h = solarHourForTick(tick);
  const fromMidnight = Math.min(h, 24 - h); // hours from solar midnight, 0..12
  return 1 - smoothstep(4.5, 7, fromMidnight);
}
