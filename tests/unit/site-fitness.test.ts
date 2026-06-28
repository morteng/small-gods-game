// tests/unit/site-fitness.test.ts
// The Tier-2 situational-fitness substrate (building-validity epic S3): the generalized
// alignment primitive (shared with the shrine axis-mundi work), the sun frontage/site
// scorers, and the composable weighted site-fitness mean S5 builds on.
import { describe, it, expect } from 'vitest';
import {
  SUN_BEARING, alignmentScore, sunFrontageScore, sunSiteScore, scoreSite, siteFitness,
} from '@/world/site-fitness';

describe('alignmentScore — the generalized alignment primitive', () => {
  it('1 when facing straight at the target, 0 when facing away, 0.5 across', () => {
    expect(alignmentScore(0, 1, 0, 1)).toBe(1);
    expect(alignmentScore(0, 1, 0, -1)).toBe(0);
    expect(alignmentScore(1, 0, 0, 1)).toBeCloseTo(0.5, 12);
    expect(alignmentScore(-1, 0, 0, 1)).toBeCloseTo(0.5, 12);
  });
  it('normalises non-unit vectors (magnitude is irrelevant, only direction)', () => {
    expect(alignmentScore(0, 5, 0, 2)).toBeCloseTo(1, 12);
    expect(alignmentScore(0, 5, 0, -9)).toBeCloseTo(0, 12);
  });
  it('a zero-length input is neutral (0.5), never NaN', () => {
    expect(alignmentScore(0, 0, 0, 1)).toBe(0.5);
    expect(alignmentScore(0, 1, 0, 0)).toBe(0.5);
  });
  it('is monotonic as a facing sweeps from toward to away', () => {
    const toward = alignmentScore(0, 1, 0, 1);       // aligned
    const diag = alignmentScore(1, 1, 0, 1);          // 45° off
    const across = alignmentScore(1, 0, 0, 1);        // 90° off
    expect(toward).toBeGreaterThan(diag);
    expect(diag).toBeGreaterThan(across);
  });
});

describe('sunFrontageScore — how sunlit a frontage is', () => {
  it('south-facing frontage is fully sunlit, north-facing is in shadow', () => {
    expect(sunFrontageScore(SUN_BEARING[0], SUN_BEARING[1])).toBe(1); // straight at the sun
    expect(sunFrontageScore(0, -1)).toBe(0);                          // away from the sun
    expect(sunFrontageScore(1, 0)).toBeCloseTo(0.5, 12);             // sidelit
  });
  it('respects an explicit (e.g. styled-world) bearing override', () => {
    expect(sunFrontageScore(1, 0, [1, 0])).toBe(1); // east-sun world: east frontage is sunlit
  });
});

describe('sunSiteScore — terrain aspect coupled to the sun', () => {
  it('flat ground is neutral regardless of aspect', () => {
    expect(sunSiteScore(0, 1, 0)).toBe(0.5);
    expect(sunSiteScore(0, -1, 0)).toBe(0.5);
    expect(sunSiteScore(0, 0, 0)).toBe(0.5);
  });
  it('a steep sun-facing slope is the brightest site; the shaded slope the worst', () => {
    expect(sunSiteScore(0, 1, 1)).toBe(1);   // full slope, aspect at the sun
    expect(sunSiteScore(0, -1, 1)).toBe(0);  // full slope, aspect away
  });
  it('the bias scales with slope (a gentle slope barely tilts off neutral)', () => {
    expect(sunSiteScore(0, 1, 0.5)).toBeCloseTo(0.75, 12);
    expect(sunSiteScore(0, -1, 0.5)).toBeCloseTo(0.25, 12);
  });
});

describe('scoreSite — composable weighted multi-criteria fitness', () => {
  it('no terms (or all-zero weights) is neutral 0.5, never NaN', () => {
    expect(scoreSite([])).toBe(0.5);
    expect(scoreSite([{ id: 'a', weight: 0, score: 1 }])).toBe(0.5);
  });
  it('a single term returns its score', () => {
    expect(scoreSite([{ id: 'sun', weight: 2, score: 0.8 }])).toBeCloseTo(0.8, 12);
  });
  it('is the normalised weighted mean of its terms', () => {
    expect(scoreSite([
      { id: 'a', weight: 1, score: 1 },
      { id: 'b', weight: 1, score: 0 },
    ])).toBeCloseTo(0.5, 12);
    expect(scoreSite([
      { id: 'a', weight: 3, score: 1 },
      { id: 'b', weight: 1, score: 0 },
    ])).toBeCloseTo(0.75, 12);
  });
  it('zero-weight terms drop out and scores are clamped to 0..1', () => {
    expect(scoreSite([
      { id: 'over', weight: 1, score: 5 },   // clamps to 1
      { id: 'under', weight: 1, score: -3 }, // clamps to 0
      { id: 'off', weight: 0, score: 1 },    // ignored
    ])).toBeCloseTo(0.5, 12);
  });
});

describe('siteFitness — settlement building disposition over the affordance layer', () => {
  // A sunlit, far-seen eminence vs a snug, sheltered hollow.
  const eminence = { prominence: 0.9, sunny: 0.9, shelter: 0.1, flatness: 0.8 };
  const hollow = { prominence: 0.1, sunny: 0.2, shelter: 0.9, flatness: 0.8 };

  it('a prominent building prefers the eminence; a humble one the hollow', () => {
    expect(siteFitness(eminence, 'prominent')).toBeGreaterThan(siteFitness(hollow, 'prominent'));
    expect(siteFitness(hollow, 'humble')).toBeGreaterThan(siteFitness(eminence, 'humble'));
  });

  it('the two profiles rank the SAME two sites oppositely (disposition, not absolute quality)', () => {
    const promChoosesEminence = siteFitness(eminence, 'prominent') > siteFitness(hollow, 'prominent');
    const humbleChoosesHollow = siteFitness(hollow, 'humble') > siteFitness(eminence, 'humble');
    expect(promChoosesEminence && humbleChoosesHollow).toBe(true);
  });

  it('an unprobed / empty affordance is neutral (flatness defaults 0.5), never NaN', () => {
    const p = siteFitness({}, 'prominent');
    const h = siteFitness({}, 'humble');
    expect(Number.isFinite(p)).toBe(true);
    expect(Number.isFinite(h)).toBe(true);
    expect(p).toBeGreaterThan(0);
    expect(h).toBeGreaterThan(0);
  });

  it('coerces non-numeric / NaN affordance values defensively', () => {
    const dirty = { prominence: 'high' as unknown as number, sunny: NaN, flatness: 0.5 };
    expect(Number.isFinite(siteFitness(dirty, 'prominent'))).toBe(true);
  });

  it('flatness always pulls — a flat prominent site beats a cliff-sited one, all else equal', () => {
    const flat = { prominence: 0.5, sunny: 0.5, flatness: 1 };
    const steep = { prominence: 0.5, sunny: 0.5, flatness: 0 };
    expect(siteFitness(flat, 'prominent')).toBeGreaterThan(siteFitness(steep, 'prominent'));
  });
});
