import type { System, SystemContext } from '@/core/scheduler';
import type { Entity } from '@/core/types';
import { DAYS_PER_YEAR } from '@/core/calendar';
import { queryNpcs, npcProps } from '@/world/npc-helpers';
import { killNpc } from '@/world/npc-lifecycle';
import { ageInYears, annualMortality } from '@/sim/mortality';

/** Below this many living NPCs, mortality is disabled so the cradle can't die out. */
export const CRADLE_MORTALITY_FLOOR = 4;

/**
 * 0.25 Hz → one fire per 4000 sim-ms = 240 ticks = one in-game day (TICKS_PER_DAY).
 * We treat each fire as one day, converting the annual hazard to a per-day chance.
 */
export const MORTALITY_TICK_HZ = 0.25;

/** Per-day death chance derived from the annual hazard (1 of DAYS_PER_YEAR fires/yr). */
function perDayMortality(age: number): number {
  return 1 - Math.pow(1 - annualMortality(age), 1 / DAYS_PER_YEAR);
}

export class MortalitySystem implements System {
  readonly name = 'mortality';
  readonly tickHz = MORTALITY_TICK_HZ;

  tick(ctx: SystemContext): void {
    const living = queryNpcs(ctx.world);
    if (living.length < CRADLE_MORTALITY_FLOOR) return;

    // Stable order so the rng draw sequence is reproducible under replay.
    const ordered = living.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const victims: Entity[] = [];
    for (const e of ordered) {
      const age = ageInYears(npcProps(e).birthTick, ctx.now);
      if (ctx.rng.next() < perDayMortality(age)) victims.push(e);
    }
    for (const e of victims) killNpc(ctx.world, e, ctx.now, 'old_age', ctx.log);
  }
}
