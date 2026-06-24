import type { System, SystemContext } from '@/core/scheduler';
import { advanceRoadEvolution, connectomeEvolveOptions } from '@/world/road-evolution';

/**
 * Roads age, wear, are repaired, and overgrow over time. This system advances the road
 * graph's dynamics toward the current sim tick; the heavy carve/surface re-derivation is
 * gated inside {@link advanceRoadEvolution} to at most ~twice per in-game year, so a high
 * fire rate is harmless. Stateless: the graph carries its own clock (`evolvedAtTick`), so
 * the system is snapshot/replay-safe and needs no rng (sim determinism preserved).
 *
 * Upkeep/traffic default from road class today; wiring per-edge settlement prosperity and
 * per-edge climate (weather-system wetness) into the opts is the connectome follow-up.
 */
export class RoadEvolutionSystem implements System {
  readonly name = 'road-evolution';
  /** 0.1 Hz — a coarse heartbeat; the real cadence is the years-gate in advanceRoadEvolution. */
  readonly tickHz = 0.1;

  tick(ctx: SystemContext): void {
    const map = ctx.world.tiles;
    const graph = map.roadGraph;
    if (!graph || graph.edges.length === 0) return;
    // Upkeep/traffic come from the endpoint settlements: a road outlives a thriving town
    // and rots toward a declining one. (Building the options is cheap and gated to the
    // rare ticks that actually apply by advanceRoadEvolution's years-gate.)
    advanceRoadEvolution(graph, ctx.now, connectomeEvolveOptions(map));
  }
}
