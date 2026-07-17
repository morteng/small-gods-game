/**
 * Desire-line trample systems.
 *
 * Two throttled, separate passes over the shared `TrampleGrid` (`@/sim/trample`)
 * — the accumulator is never swept in full per frame:
 *
 *  - `TrampleDepositSystem` (~3 Hz ≈ one deposit per agent per ~20 ticks): each
 *    fire drops a wear quantum at every NPC's current tile, gated to soft ground.
 *  - `TramplePromoteDecaySystem` (0.25 Hz, one pass per 4 s): promotes worn
 *    ground to `dirt`, decays wear, reverts faded trails.
 *
 * 1:1-REALTIME NOTE: both cadences and the grid's per-pass magnitudes are
 * REAL-TIME tuned as a deposit-vs-decay equilibrium (trails emerge from live
 * traffic during play and fade over real hours-to-days). Re-keying decay to
 * fiction days while deposits track real NPC footfall would shift the
 * equilibrium ~250,000:1 toward wear — so the pair deliberately keeps its
 * real-time balance.
 *
 * Both read the live map + grid via closures (like `NpcMovementSystem` /
 * `WeatherSystem`), since neither rides on `SystemContext`.
 */

import type { System, SystemContext } from '@/core/scheduler';
import type { GameMap } from '@/core/types';
import { forEachNpc } from '@/world/npc-helpers';
import { isTrampleEligible, type TrampleGrid } from '@/sim/trample';
import { ROAD_TILE_TYPES } from '@/world/road-graph';
import type { RoadUseTally } from '@/world/road-use';

/** Deposit fires ~every 20 ticks (one wear quantum per agent per ~20 ticks). */
export const TRAMPLE_DEPOSIT_HZ = 3;
/** Promote/decay fires every 4 s (real-time equilibrium — see header note). */
export const TRAMPLE_DECAY_HZ = 0.25;

export class TrampleDepositSystem implements System {
  readonly name = 'trample_deposit';
  readonly tickHz = TRAMPLE_DEPOSIT_HZ;

  constructor(
    private readonly getMap: () => GameMap | null,
    private readonly getGrid: () => TrampleGrid | null,
    /** Road-wear economy S1: the per-edge footfall tally. Footfall the trample grid DISCARDS
     *  (roads are trample-inert) is instead attributed to the road's graph edge here — the same
     *  loop, no new system. Optional so headless/pre-S1 states run without a tally. */
    private readonly getRoadUse: () => RoadUseTally | null = () => null,
  ) {}

  tick(ctx: SystemContext): void {
    const map = this.getMap();
    const grid = this.getGrid();
    if (!map || !grid) return;
    const roadUse = this.getRoadUse();
    const graph = roadUse ? map.roadGraph : null;
    forEachNpc(ctx.world, (e) => {
      const tx = Math.floor(e.x);
      const ty = Math.floor(e.y);
      const tile = map.tiles[ty]?.[tx];
      // Gate at deposit: soft ground can FORM a desire line, and a tile already
      // worn to a `dirt` trail keeps taking wear so continued traffic SUSTAINS it
      // (without this, a busy trail would decay and revert — re-introducing the
      // flicker the hysteresis prevents). Footfall on roads/plazas/water leaves
      // no wear — roads are already the wanted path. The 8-neighbour SPILL
      // (×SPILL_FACTOR, eligible cells only) widens busy trunk trails to 2–3
      // tiles while side paths stay single-file.
      if (isTrampleEligible(tile) || grid.isPromoted(tx, ty)) {
        grid.depositWithSpill(map, tx, ty);
      } else if (graph && roadUse && tile && ROAD_TILE_TYPES.has(tile.type)) {
        // Footfall a road SHEDS from the trample grid still records as USE on the graph edge —
        // this is the road-wear economy's measured-traffic signal (S1). Off any edge → no-op.
        roadUse.noteFootfall(graph, tx, ty, map.width, map.height);
      }
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
