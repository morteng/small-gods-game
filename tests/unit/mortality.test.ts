import { describe, it, expect } from 'vitest';
import {
  ageInYears, annualMortality, survivalProbability, rollDeathYear,
  ADULT_AGE, MAX_AGE,
} from '@/sim/mortality';
import { TICKS_PER_DAY, DAYS_PER_YEAR } from '@/core/calendar';

const TICKS_PER_YEAR = TICKS_PER_DAY * DAYS_PER_YEAR;

describe('ageInYears', () => {
  it('converts elapsed ticks to fractional years', () => {
    expect(ageInYears(0, TICKS_PER_YEAR * 20)).toBeCloseTo(20, 5);
  });
  it('handles a back-dated (negative) birthTick at now=0', () => {
    expect(ageInYears(-TICKS_PER_YEAR * 25, 0)).toBeCloseTo(25, 5);
  });
});

describe('annualMortality', () => {
  it('is bounded to [0,1] across the whole age range', () => {
    for (let age = 0; age <= 120; age++) {
      const m = annualMortality(age);
      expect(m).toBeGreaterThanOrEqual(0);
      expect(m).toBeLessThanOrEqual(1);
    }
  });
  it('is low and ~flat through adulthood', () => {
    expect(annualMortality(ADULT_AGE)).toBeLessThan(0.02);
    expect(annualMortality(40)).toBeLessThan(0.02);
  });
  it('is monotonic non-decreasing for age >= adulthood', () => {
    let prev = -1;
    for (let age = ADULT_AGE; age <= 120; age++) {
      const m = annualMortality(age);
      expect(m).toBeGreaterThanOrEqual(prev);
      prev = m;
    }
  });
  it('reaches certainty by the maximum age', () => {
    expect(annualMortality(MAX_AGE)).toBeCloseTo(1, 5);
    expect(annualMortality(MAX_AGE + 20)).toBe(1);
  });
});

describe('survivalProbability', () => {
  it('is 1 over zero years', () => {
    expect(survivalProbability(30, 0)).toBe(1);
  });
  it('is in [0,1] and decreases as the interval lengthens', () => {
    const s5 = survivalProbability(30, 5);
    const s50 = survivalProbability(30, 50);
    expect(s5).toBeLessThanOrEqual(1);
    expect(s50).toBeGreaterThanOrEqual(0);
    expect(s50).toBeLessThan(s5);
  });
});

describe('rollDeathYear', () => {
  it('returns null when a young adult almost certainly survives a short span', () => {
    expect(rollDeathYear(25, 5, 0.999)).toBeNull();
  });
  it('returns an in-range offset when the soul dies', () => {
    const y = rollDeathYear(90, 10, 0.0);
    expect(y).not.toBeNull();
    expect(y!).toBeGreaterThanOrEqual(0);
    expect(y!).toBeLessThan(10);
  });
  it('is deterministic for a given rngFloat', () => {
    expect(rollDeathYear(70, 30, 0.5)).toBe(rollDeathYear(70, 30, 0.5));
  });
});
