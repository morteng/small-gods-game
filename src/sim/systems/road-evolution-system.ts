import type { System, SystemContext } from '@/core/scheduler';
import type { SettlementCohorts } from '@/sim/cohorts';
import type { RoadUseTally } from '@/world/road-use';
import { advanceRoadEvolution, connectomeEvolveOptions, buildRoadUseInputs } from '@/world/road-evolution';
import { foldRoadUse } from '@/world/road-use';
import { residentsByPoi } from '@/sim/systems/settlement-growth-system';
import { getClimateFields } from '@/world/heightfield';

/**
 * Roads age, wear, are repaired, and overgrow over time. This system advances the road
 * graph's dynamics toward the current sim tick; the heavy carve/surface re-derivation is
 * gated inside {@link advanceRoadEvolution} to at most ~twice per in-game year, so a high
 * fire rate is harmless. Stateless: the graph carries its own clock (`evolvedAtTick`), so
 * the system is snapshot/replay-safe and needs no rng (sim determinism preserved).
 *
 * Upkeep/traffic come from each road's endpoint settlements (live resident count vs the
 * settlement's baseline), and weather aggression from the per-tile climate where the road runs.
 * The opts gather (an O(NPCs) census + the climate fields) is deferred behind a thunk so it only
 * runs on the rare ticks that actually apply past advanceRoadEvolution's half-year gate.
 *
 * Road-wear economy S1: on the SAME applying year-pass, the measured-footfall tally (fed 3 Hz by
 * the trample deposit system) is folded into each edge's `use` EMA — gated identically, so no new
 * cadence. Nothing READS `use` yet (S2/S3 wire the class + crossing ladders to it).
 */
export class RoadEvolutionSystem implements System {
  readonly name = 'road-evolution';
  /** 0.1 Hz — a coarse heartbeat; the real cadence is the years-gate in advanceRoadEvolution. */
  readonly tickHz = 0.1;

  constructor(
    private readonly getRoadUse: () => RoadUseTally | null = () => null,
    private readonly getCohorts: () => ReadonlyMap<string, SettlementCohorts> | null = () => null,
  ) {}

  tick(ctx: SystemContext): void {
    const map = ctx.world.tiles;
    const graph = map.roadGraph;
    if (!graph || graph.edges.length === 0) return;
    // A road outlives a thriving town and rots toward a declining one; a cold/wet road wears
    // faster than a dry one. The residents census + climate fields are gathered lazily — only
    // when the years-gate actually fires (twice an in-game year), not on every 0.1 Hz heartbeat.
    const dtYears = advanceRoadEvolution(graph, ctx.now, () =>
      connectomeEvolveOptions(map, {
        residents: residentsByPoi(ctx.world),
        climate: getClimateFields(map),
      }),
    );

    // Fold the use tally on the same applying year-pass (dtYears > 0). The fold measures over the
    // tally's OWN window, so it composes with time-skips for free (an abandoned road reads low).
    const tally = this.getRoadUse();
    if (dtYears > 0 && tally) {
      const cohorts = this.getCohorts() ?? undefined;
      foldRoadUse(
        graph, tally, ctx.now,
        buildRoadUseInputs(map, { residents: residentsByPoi(ctx.world, cohorts), cohorts }),
      );
    }
  }
}
