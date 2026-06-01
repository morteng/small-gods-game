import { TICKS_PER_DAY, DAYS_PER_YEAR } from '@/core/calendar';

/** Ticks in one simulated year (23,040 at the current calendar). */
export const TICKS_PER_YEAR = TICKS_PER_DAY * DAYS_PER_YEAR;

/** Age at which an NPC is considered an adult (mortality monotonic from here). */
export const ADULT_AGE = 15;
/** Flat baseline annual mortality through adulthood (~0.5%/yr). */
export const BASE_MORTALITY = 0.005;
/** Age at which senescence begins ramping mortality upward. */
export const SENESCENCE_START = 55;
/** Age at which annual mortality reaches certainty (1.0). */
export const MAX_AGE = 95;

function clamp01(v: number): number { return Math.max(0, Math.min(1, v)); }

/** Fractional age in years derived from birth tick and the current tick. */
export function ageInYears(birthTick: number, now: number): number {
  return (now - birthTick) / TICKS_PER_YEAR;
}

/**
 * Probability of dying within one year at a given age. Gentle pre-modern curve:
 * flat ~0.5%/yr through adulthood, then a quadratic ramp from SENESCENCE_START
 * up to certainty at MAX_AGE. Monotonic non-decreasing for age >= adulthood,
 * clamped to [0,1].
 */
export function annualMortality(age: number): number {
  if (age <= SENESCENCE_START) return BASE_MORTALITY;
  if (age >= MAX_AGE) return 1;
  const t = (age - SENESCENCE_START) / (MAX_AGE - SENESCENCE_START); // 0..1
  return clamp01(BASE_MORTALITY + (1 - BASE_MORTALITY) * t * t);
}

/** Probability of surviving `years` full years starting at `age` (closed form). */
export function survivalProbability(age: number, years: number): number {
  let s = 1;
  for (let y = 0; y < years; y++) s *= 1 - annualMortality(age + y);
  return clamp01(s);
}

/**
 * Deterministically decide whether a soul of `age` dies within `[0, years)`.
 * Walks the per-year death mass against the caller-supplied rngFloat ∈ [0,1).
 * Returns the year-offset of death, or null if the soul survives the interval.
 */
export function rollDeathYear(age: number, years: number, rngFloat: number): number | null {
  let r = rngFloat;
  let surv = 1;
  for (let y = 0; y < years; y++) {
    const m = annualMortality(age + y);
    const deathThisYear = surv * m;
    if (r < deathThisYear) return y;
    r -= deathThisYear;
    surv *= 1 - m;
  }
  return null;
}
