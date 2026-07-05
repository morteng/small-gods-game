import { smoothstep } from '@/core/math';

/**
 * TRUE 1:1 REALTIME: a calendar day = a solar day = 24 real hours at rate 1.
 * 86,400 s × 60 ticks/s. The tick stays 16.667 sim-ms; `scheduler.setRate`
 * remains a pure multiplier on top (0 = pause). Time only flows while the game
 * runs — there is deliberately NO offline catch-up.
 */
export const TICKS_PER_DAY = 5_184_000;
export const DAYS_PER_YEAR = 96;
/** Ticks per game hour (3600 s × 60 ticks/s). */
export const TICKS_PER_HOUR = TICKS_PER_DAY / 24;
/** Scheduler `tickHz` for systems that should fire once per GAME HOUR
 *  (tickHz is per sim-second; one game hour = 3600 sim-seconds). Used by the
 *  day-keyed lifecycle systems (mortality/births/growth) whose per-day rates
 *  are re-derived per-hour under 1:1 realtime. */
export const GAME_HOUR_HZ = 1 / 3600;
export const SEASONS = ['spring', 'summer', 'autumn', 'winter'] as const;
export type Season = typeof SEASONS[number];

/** Convert a per-DAY probability into a per-check probability for a system
 *  that checks `checksPerDay` times per day, preserving the per-day meaning:
 *  1 − (1 − pDay) = the chance after `checksPerDay` independent checks. */
export function perCheckFromPerDay(pDay: number, checksPerDay: number): number {
  return 1 - Math.pow(1 - pDay, 1 / checksPerDay);
}

export interface CalendarTick {
  year: number;
  season: Season;
  day: number;
  dayOfYear: number;
}

/** Index (0-based) of the calendar day containing `tick`, with day boundaries
 *  at solar MIDNIGHT. Tick 0 is `SOLAR_START_HOUR` (09:00) of day 0, so day 1
 *  begins 15 game-hours in — the world "begins" mid-morning, like waking up. */
export function dayIndexForTick(tick: number): number {
  return Math.floor((Math.floor(tick) + (SOLAR_START_HOUR / 24) * TICKS_PER_DAY) / TICKS_PER_DAY);
}

export function formatCalendarTick(tick: number): CalendarTick {
  const dayIdx = dayIndexForTick(Math.max(0, tick));
  const year = Math.floor(dayIdx / DAYS_PER_YEAR) + 1;
  const dayOfYear = (dayIdx % DAYS_PER_YEAR) + 1;
  const seasonLen = Math.floor(DAYS_PER_YEAR / SEASONS.length);
  const seasonIdx = Math.min(SEASONS.length - 1, Math.floor((dayOfYear - 1) / seasonLen));
  return {
    year,
    season: SEASONS[seasonIdx],
    day: ((dayOfYear - 1) % seasonLen) + 1,
    dayOfYear,
  };
}

/** "HH:MM" of the solar day at `tick` — the game clock runs 1:1 with real time. */
export function solarTimeLabel(tick: number): string {
  const h = solarHourForTick(tick);
  const hh = Math.floor(h);
  const mm = Math.floor((h - hh) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export function calendarLabel(tick: number): string {
  const c = formatCalendarTick(tick);
  return `Y${c.year} ${c.season} · ${c.dayOfYear}/${DAYS_PER_YEAR} · ${solarTimeLabel(tick)}`;
}

/* ── The solar day (day/night cycle) ───────────────────────────────────────
 *
 * ONE coherent clock: the solar day IS the calendar day (24 real hours at
 * rate 1). SOLAR_DAY_CALENDAR_DAYS is kept (=1) because round-7 day/night
 * lighting and its tests key off TICKS_PER_SOLAR_DAY; the old 60-day visual
 * decoupling existed only because a 4-second calendar day would strobe the
 * sun. Everything below stays a pure function of the tick — deterministic,
 * scrub-safe, and save/replay-stable. */
export const SOLAR_DAY_CALENDAR_DAYS = 1;
export const TICKS_PER_SOLAR_DAY = TICKS_PER_DAY * SOLAR_DAY_CALENDAR_DAYS;
/** Solar hour at tick 0 — the fixed-hour FALLBACK (tests/studio/worlds without
 *  a wall-clock anchor boot mid-morning, not in the dark). Freshly generated
 *  worlds instead stamp the clock's starting tick from the player's local time
 *  (see `solarAnchorTickForDate` + bootstrap-world). */
export const SOLAR_START_HOUR = 9;

/** Hour-of-day (0..24, 0 = solar midnight) of the VISUAL solar day at `tick`. */
export function solarHourForTick(tick: number): number {
  const phase = (((Math.floor(tick) / TICKS_PER_SOLAR_DAY) % 1) + 1) % 1;
  return (phase * 24 + SOLAR_START_HOUR) % 24;
}

/** First tick ≥ 0 whose solar hour is `hour` — dev/test convenience for forcing
 *  the clock to noon/midnight (`clock.setNow(tickAtSolarHour(0))`), and the
 *  primitive behind the gen-time wall-clock anchor. */
export function tickAtSolarHour(hour: number): number {
  const h = ((hour % 24) + 24) % 24;
  return Math.round((((h - SOLAR_START_HOUR + 24) % 24) / 24) * TICKS_PER_SOLAR_DAY);
}

/**
 * Wall-clock anchor (stamped ONCE at world generation): the starting tick whose
 * solar time matches the given local Date, so a world generated at 21:30 boots
 * into evening. The anchor is persisted implicitly — the clock's tick is
 * save/snapshot state — and everything downstream stays a pure deterministic
 * function of the tick. Time flows only while the game runs (no offline
 * catch-up). This is the ONLY sanctioned local-time read besides the gen seed.
 */
export function solarAnchorTickForDate(d: Date): number {
  return tickAtSolarHour(d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600);
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
