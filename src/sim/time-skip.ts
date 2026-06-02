import type { World } from '@/world/world';
import type { SimClock } from '@/core/clock';
import type { Rng } from '@/core/rng';
import type { EventLog } from '@/core/events';
import { queryNpcs, NPC_KIND } from '@/world/npc-helpers';
import { killNpc, materializeSynthChild } from '@/world/npc-lifecycle';
import { projectTurnover } from '@/sim/turnover';
import { TICKS_PER_YEAR } from '@/sim/mortality';
import { countPlayerBelievers } from '@/sim/believers';

export interface SkipSummary {
  fromTick: number;
  toTick: number;
  years: number;
  deaths: number;
  births: number;
  believersBefore: number;
  believersAfter: number;
}

/**
 * Closed-form forward jump of `years` in-game years. Applies `projectTurnover`'s
 * projected deaths (npc → remains) and births (materialized live NPCs), advances
 * the clock, and emits one `era_skipped` summary event. Survivors are untouched
 * (frozen belief) and no power regenerates — nothing ticks. Fully deterministic
 * given `rng`. Returns the summary, or `null` for a non-positive `years` no-op.
 *
 * NOTE: death/birth events are stamped at the pre-advance tick (the clock moves
 * once, at the end); fine for the baseline — only the era_skipped event (stamped
 * post-advance) drives the history strip. The caller (game layer) is responsible
 * for committing the timeline boundary via TimelineController.commitSkip().
 */
export function applySkip(
  world: World, clock: SimClock, rng: Rng, log: EventLog, years: number,
): SkipSummary | null {
  if (years <= 0) return null;

  const fromTick = clock.now();
  const believersBefore = countPlayerBelievers(world);
  const living = queryNpcs(world);
  const { deaths, births } = projectTurnover(living, years, fromTick, rng);

  for (const d of deaths) {
    const e = world.registry.get(d.id);
    if (e && e.kind === NPC_KIND) {
      killNpc(world, e, fromTick + d.deathYearOffset * TICKS_PER_YEAR, d.cause, log);
    }
  }
  for (const c of births) {
    materializeSynthChild(world, c, fromTick + c.birthYearOffset * TICKS_PER_YEAR, rng, log);
  }

  const toTick = fromTick + years * TICKS_PER_YEAR;
  clock.setNow(toTick);
  const believersAfter = countPlayerBelievers(world);

  const summary: SkipSummary = {
    fromTick, toTick, years,
    deaths: deaths.length, births: births.length,
    believersBefore, believersAfter,
  };
  log.append({ type: 'era_skipped', ...summary });
  return summary;
}
