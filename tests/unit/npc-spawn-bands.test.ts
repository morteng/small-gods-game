/**
 * A soul must be born INSIDE the band it will live in (S2c).
 *
 * The defect this pins: `initNpcProps` seeded `community` at 0.55 — the midpoint
 * of the OLD socialize band ([0.35, 0.65]) — and the statistical tier seeded its
 * bands at 0.5. When S2c moved `COMMUNITY_THRESHOLD` to 0.65 those two spawn
 * values were left behind, so EVERY mortal in the world, named or materialized,
 * arrived below its own socialize line. Since the socialize branch outranks both
 * `work` and `patrol`, a fresh soul's very first errand was a trip to the green:
 * a castle knight abandoned his patrol and a freshly materialized farmhand went
 * to the well before it had ever worked a day (caught by `knights-m5` and
 * `materialization-schedule`).
 *
 * The ordering is NOT the bug and is deliberately left alone — measured over a
 * full 24-hour day, `socialize` is 0.03% of a mortal's waking fires and a castle
 * knight patrols 76.4% of his. The spawn values were the bug.
 */
import { describe, it, expect } from 'vitest';
import { initNpcProps } from '@/world/npc-helpers';
import { STAT_COMMUNITY_EQUILIBRIUM, STAT_UNTITHED_PROSPERITY } from '@/sim/cohorts';
import type { NpcRole } from '@/core/types';

/** Mirrors `COMMUNITY_THRESHOLD` + `SELF_AGENCY_RESTORE` in
 *  `src/sim/systems/npc-activity-system.ts`. Both are module-private there;
 *  restating them HERE is the point of this test — if either moves, this fails
 *  and names the two spawn seeds that have to move with it. */
const SOCIALIZE_TRIGGER = 0.65;
const SELF_AGENCY_RESTORE = 0.3;

const ROLES: NpcRole[] = ['farmer', 'priest', 'soldier', 'merchant', 'noble', 'child', 'beggar', 'elder'];

describe('spawn values sit inside the bands mortals live in', () => {
  it('every named soul is born inside the socialize band, whatever its seed', () => {
    for (const role of ROLES) {
      for (let seed = 1; seed <= 200; seed++) {
        const c = initNpcProps(`n${seed}`, role, seed * 7919).needs.community;
        expect(c, `${role}/${seed} spawns below its own socialize line`)
          .toBeGreaterThanOrEqual(SOCIALIZE_TRIGGER);
        expect(c).toBeLessThanOrEqual(SOCIALIZE_TRIGGER + SELF_AGENCY_RESTORE);
      }
    }
  });

  it('the statistical tier seeds the same band (a materialized extra is not a newborn)', () => {
    expect(STAT_COMMUNITY_EQUILIBRIUM).toBeGreaterThanOrEqual(SOCIALIZE_TRIGGER);
    expect(STAT_COMMUNITY_EQUILIBRIUM).toBeLessThanOrEqual(SOCIALIZE_TRIGGER + SELF_AGENCY_RESTORE);
    // The two tiers must not disagree about what a typical soul feels: a fold
    // and a re-materialization round-trip through these means.
    expect(initNpcProps('mid', 'farmer', 1).needs.community).toBeCloseTo(STAT_COMMUNITY_EQUILIBRIUM, 1);
  });

  it('the statistical prosperity equilibrium is unchanged (not part of this fix)', () => {
    expect(STAT_UNTITHED_PROSPERITY).toBe(0.5);
  });
});
