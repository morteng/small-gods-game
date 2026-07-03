/**
 * Desire-line trample systems.
 *
 * Two throttled, separate passes over the shared `TrampleGrid` (`@/sim/trample`)
 * — the accumulator is never swept in full per frame:
 *
 *  - `TrampleDepositSystem` (~3 Hz ≈ one deposit per agent per ~20 ticks): each
 *    fire drops a wear quantum at every NPC's current tile, gated to soft ground.
 *  - `TramplePromoteDecaySystem` (0.25 Hz, one pass per in-game day): promotes
 *    worn ground to `dirt`, decays wear, reverts faded trails.
 *
 * Both read the live map + grid via closures (like `NpcMovementSystem` /
 * `WeatherSystem`), since neither rides on `SystemContext`.
 */

import type { System, SystemContext } from '@/core/scheduler';
import type { GameMap } from '@/core/types';
import { forEachNpc } from '@/world/npc-helpers';
import { isTrampleEligible, type TrampleGrid } from '@/sim/trample';

/** Deposit fires ~every 20 ticks (one wear quantum per agent per ~20 ticks). */
export const TRAMPLE_DEPOSIT_HZ = 3;
/** Promote/decay fires once per in-game day (240 ticks), like Mortality's cadence. */
export const TRAMPLE_DECAY_HZ = 0.25;

export class TrampleDepositSystem implements System {
  readonly name = 'trample_deposit';
  readonly tickHz = TRAMPLE_DEPOSIT_HZ;

  constructor(
    private readonly getMap: () => GameMap | null,
    private readonly getGrid: () => TrampleGrid | null,
  ) {}

  tick(ctx: SystemContext): void {
    const map = this.getMap();
    const grid = this.getGrid();
    if (!map || !grid) return;
    forEachNpc(ctx.world, (e) => {
      const tx = Math.floor(e.x);
      const ty = Math.floor(e.y);
      // Gate at deposit: soft ground can FORM a desire line, and a tile already
      // worn to a `dirt` trail keeps taking wear so continued traffic SUSTAINS it
      // (without this, a busy trail would decay and revert — re-introducing the
      // flicker the hysteresis prevents). Footfall on roads/plazas/water leaves
      // no wear — roads are already the wanted path.
      if (isTrampleEligible(map.tiles[ty]?.[tx]) || grid.isPromoted(tx, ty)) grid.deposit(tx, ty);
    });
  }
}

export class TramplePromoteDecaySystem implements System {
  readonly name = 'trample_decay';
  readonly tickHz = TRAMPLE_DECAY_HZ;

  constructor(
    private readonly getMap: () => GameMap | null,
    private readonly getGrid: () => TrampleGrid | null,
  ) {}

  tick(_ctx: SystemContext): void {
    const map = this.getMap();
    const grid = this.getGrid();
    if (!map || !grid) return;
    grid.promoteDecay(map);
  }
}
