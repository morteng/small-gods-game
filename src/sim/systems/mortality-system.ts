import type { System, SystemContext } from '@/core/scheduler';
import type { Entity } from '@/core/types';
import { DAYS_PER_YEAR, GAME_HOUR_HZ } from '@/core/calendar';
import { queryNpcs, npcProps } from '@/world/npc-helpers';
import { killNpc } from '@/world/npc-lifecycle';
import { ageInYears, annualMortality } from '@/sim/mortality';

/** Below this many living NPCs, mortality is disabled so the cradle can't die out. */
export const CRADLE_MORTALITY_FLOOR = 4;

/**
 * One fire per GAME HOUR. Under 1:1 realtime a day is 24 real hours; the old
 * 0.25 Hz cadence (one fire per 4 s = one COMPRESSED day) would check 21,600×
 * per day, which both churns the rng stream and pushes the per-check hazard
 * below sfc32's ~2.3e-10 float resolution. Hourly checks keep the per-day
 * hazard exact (per-hour derivation below) with clean probability resolution.
 */
export const MORTALITY_TICK_HZ = GAME_HOUR_HZ;

/** Per-HOUR death chance derived from the annual hazard (DAYS_PER_YEAR × 24
 *  checks per year) — preserves the per-day/per-year mortality meaning. */
function perHourMortality(age: number): number {
  return 1 - Math.pow(1 - annualMortality(age), 1 / (DAYS_PER_YEAR * 24));
}

export class MortalitySystem implements System {
  readonly name = 'mortality';
  readonly tickHz = MORTALITY_TICK_HZ;

  tick(ctx: SystemContext): void {
    // P2: materialized extras (temporary embodiments of statistical cohort souls,
    // drawn only while a settlement is focused) are excluded — mortality picking
    // one would leak a soul out of its cohort AND make the death draw sequence
    // focus-dependent (a headless replay never spawns them). They fold back into
    // the cohort untouched; only permanent named souls age and die.
    const living = queryNpcs(ctx.world).filter(e => npcProps(e).materializedTemp !== true);
    if (living.length < CRADLE_MORTALITY_FLOOR) return;

    // Stable order so the rng draw sequence is reproducible under replay.
    const ordered = living.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const victims: Entity[] = [];
    for (const e of ordered) {
      const age = ageInYears(npcProps(e).birthTick, ctx.now);
      if (ctx.rng.next() < perHourMortality(age)) victims.push(e);
    }
    for (const e of victims) killNpc(ctx.world, e, ctx.now, 'old_age', ctx.log);
  }
}
