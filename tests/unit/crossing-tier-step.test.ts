// Road-wear economy S3 — the PURE crossing-tier decision functions (`stepCrossing` +
// `nextBuildableTier`, src/world/road-use.ts). This is the crossing analogue of the S2 class-
// ladder matrix (`road-class-evolution.test.ts`): promote-fast hysteresis (N_UP sustained
// qualifying applies), one BUILDABLE rung per apply, span-skipping of a non-spanning intermediate
// rung, and the rule that makes the medieval landscape we want — a crossing NEVER steps down
// (the built tier is monotonic; a fall in `earned` just stops it being maintained).
//
// Nothing here touches the store, the world, or persistence — these are the same pure functions the
// crossing-site studio dials drive and the store composes with, verified in isolation.
import { describe, it, expect } from 'vitest';
import {
  stepCrossing, nextBuildableTier, tierSpans,
  N_UP, CROSSING_TIER_MAX_SPAN_T, type CrossingTier,
} from '@/world/road-use';

// A span the low roundwood rungs CAN carry (≤ 2 tiles → even a single log spans it), so the
// ladder walks rung-by-rung and the promote/streak behaviour is what the assertions isolate.
const NARROW = 1;
// A span that only a plank walk (bents, tier 3) or the arches (5/6) can carry — tiers 1,2 and the
// single sawn beam (tier 4) are all span-limited below it — so `nextBuildableTier` must SKIP them.
// MAX_SPAN = [2, 2, 2.5, 8, 5, 9, 14]: 7 clears the plank walk (8) and the arches (9/14) but not
// the twin/rail logs (2/2.5) nor the framed beam (5). This is the §10 "max span is NOT monotonic"
// teaching point made executable.
const WIDE = 7;

describe('nextBuildableTier — the next physically-buildable rung above `built`', () => {
  it('returns the LOWEST rung in (built, earned] that can span the channel', () => {
    // Narrow water: every rung spans it, so the next one up (1) is buildable.
    expect(nextBuildableTier(0, 5, NARROW)).toBe(1);
    expect(nextBuildableTier(3, 5, NARROW)).toBe(4);
  });

  it('SPAN-SKIPS a non-spanning intermediate rung (the max-span table is not monotonic)', () => {
    // built 3 (plank walk), earned 5 (timber arch), WIDE channel: tier 4 (framed beam, span 5)
    // cannot carry 7 tiles, but tier 5 (timber arch, span 9) can — so the ladder jumps 3 → 5,
    // never pausing on the un-buildable beam. (Sanity-pin the span facts the jump relies on.)
    expect(tierSpans(4 as CrossingTier, WIDE)).toBe(false);
    expect(tierSpans(5 as CrossingTier, WIDE)).toBe(true);
    expect(nextBuildableTier(3, 5, WIDE)).toBe(5);
  });

  it('is a no-op (returns `built`) when nothing buildable sits in (built, earned]', () => {
    // earned == built: no rung above.
    expect(nextBuildableTier(3, 3, NARROW)).toBe(3);
    // The only rung in range (4) can't span the WIDE channel, and earned caps below the arch → 3.
    expect(nextBuildableTier(3, 4, WIDE)).toBe(3);
    // earned below built (a demoted class): the loop never runs → `built` unchanged.
    expect(nextBuildableTier(5, 2, NARROW)).toBe(5);
  });
});

describe('stepCrossing — one year-pass of the crossing-tier ladder (promote-fast, never down)', () => {
  it('promotes exactly ONE buildable rung after N_UP consecutive qualifying applies', () => {
    // built 0, earned 5, narrow channel — the next buildable rung is 1.
    let up = 0;
    // First N_UP-1 applies build the streak but do NOT move the built tier.
    for (let i = 0; i < N_UP - 1; i++) {
      const s = stepCrossing(0, 5, NARROW, up);
      expect(s.changed).toBe(false);
      expect(s.tier).toBe(0);
      expect(s.upStreak).toBe(up + 1);
      up = s.upStreak;
    }
    // The N_UP-th qualifying apply moves the tier up exactly one buildable rung and resets the streak.
    const moved = stepCrossing(0, 5, NARROW, up);
    expect(moved.changed).toBe(true);
    expect(moved.tier).toBe(1); // ONE rung, not a leap to `earned`
    expect(moved.upStreak).toBe(0);
  });

  it('a streak short of N_UP does not move the tier', () => {
    expect(N_UP).toBeGreaterThan(1); // the promise only bites when N_UP ≥ 2
    const s = stepCrossing(0, 5, NARROW, 0);
    expect(s).toEqual({ tier: 0, upStreak: 1, changed: false });
  });

  it('a non-qualifying apply breaks the streak (streaks are consecutive applies, not a lifetime tally)', () => {
    // A near-complete streak (up = N_UP-1) meets an apply where earned offers nothing buildable
    // above built → the streak resets to 0, so it must start over from scratch next time.
    const s = stepCrossing(0, 0, NARROW, N_UP - 1);
    expect(s.changed).toBe(false);
    expect(s.tier).toBe(0);
    expect(s.upStreak).toBe(0);
  });

  it('NEVER steps down: earned < built is a non-qualifying no-op (the built tier is monotonic)', () => {
    // A stranded stone arch (built 6) on a demoted track (earned 2): the crossing holds — it just
    // stops being maintained. No down-streak exists at all.
    for (const streak of [0, 1, N_UP, 99]) {
      const s = stepCrossing(6, 2, NARROW, streak);
      expect(s.changed).toBe(false);
      expect(s.tier).toBe(6);
      expect(s.upStreak).toBe(0); // a no-op apply always clears the up-streak
    }
  });

  it('span-skips the intermediate rung on the qualifying apply too (3 → 5 across a wide channel)', () => {
    // built 3, earned 5, WIDE: after N_UP qualifying applies it lands on 5, skipping the un-spanning 4.
    let up = 0;
    for (let i = 0; i < N_UP - 1; i++) up = stepCrossing(3, 5, WIDE, up).upStreak;
    const moved = stepCrossing(3, 5, WIDE, up);
    expect(moved.changed).toBe(true);
    expect(moved.tier).toBe(5);
  });

  it('nothing buildable in (built, earned] → a no-op that also clears the streak', () => {
    // The only rung above built (4) cannot span the WIDE channel: no promotion, streak reset.
    const s = stepCrossing(3, 4, WIDE, N_UP - 1);
    expect(s).toEqual({ tier: 3, upStreak: 0, changed: false });
  });

  it('pins the max-span table the ladder reads (drift guard on the §10 continuum)', () => {
    expect([...CROSSING_TIER_MAX_SPAN_T]).toEqual([2, 2, 2.5, 8, 5, 9, 14]);
  });
});
