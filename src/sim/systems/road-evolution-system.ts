import type { System, SystemContext } from '@/core/scheduler';
import type { SettlementCohorts } from '@/sim/cohorts';
import type { RoadUseTally, EdgeClassInputs, RoadClassTransition } from '@/world/road-use';
import type { RoadEdge } from '@/world/road-graph';
import { advanceRoadEvolution, connectomeEvolveOptions, buildRoadUseInputs, endpointPoiIdsFor, applyRoadClassSurface } from '@/world/road-evolution';
import { foldRoadUse, evolveRoadClasses, ROAD_CLASS_LADDER, CROSSING_TIER_LABELS } from '@/world/road-use';
import { stepCrossingTiers, corridorSitesFor, type CrossingTierStore, type CrossingUpgrade } from '@/world/crossing-tier-store';
import { detectCorridorCrossings } from '@/world/corridor-crossings';
import { residentsByPoi } from '@/sim/systems/settlement-growth-system';
import { lordSeatFunds } from '@/sim/lord';
import { getClimateFields } from '@/world/heightfield';
import type { EventLog } from '@/core/events';
import type { World } from '@/world/world';
import type { GameMap } from '@/core/types';
import type { TrampleGrid } from '@/sim/trample';

/** Build the class-ladder inputs from the live world: wealth from the use fold (one number), the
 *  highway lord-gate from the seat/dominion plumbing, and the endpoint ids for the events. */
export function buildRoadClassInputs(map: GameMap, world: World, wealthFor: (edge: RoadEdge) => number): EdgeClassInputs {
  const ids = endpointPoiIdsFor(map);
  return {
    wealthFor,
    endpointPoiIds: ids,
    hasLordSeatFor: (edge) => { const [a, b] = ids(edge); return lordSeatFunds(world, a) || lordSeatFunds(world, b); },
  };
}

/** Emit the SimEvent for one class transition (promote/demote). Shared by the live tick + skip.
 *  (Two literal `append` calls, not one with a ternary type: tsc widens the ternary discriminant
 *  and the sim-event boundary guard needs each `type:` literal near an `append(`.) */
export function emitRoadClassEvent(log: EventLog, tr: RoadClassTransition): void {
  const { edgeId, from, to, fromPoiId, toPoiId } = tr;
  if (ROAD_CLASS_LADDER.indexOf(to) > ROAD_CLASS_LADDER.indexOf(from)) {
    log.append({ type: 'road_promoted', edgeId, from, to, fromPoiId, toPoiId });
  } else {
    log.append({ type: 'road_demoted', edgeId, from, to, fromPoiId, toPoiId });
  }
}

/** Emit the SimEvent for one crossing-tier upgrade. Shared by the live tick + skip. */
export function emitCrossingUpgraded(log: EventLog, u: CrossingUpgrade): void {
  log.append({
    type: 'crossing_upgraded',
    crossingId: u.crossingId, x: u.x, y: u.y,
    to: u.to, toLabel: CROSSING_TIER_LABELS[u.to],
    ...(u.from !== undefined ? { from: u.from, fromLabel: CROSSING_TIER_LABELS[u.from] } : {}),
    ...(u.edgeId ? { edgeId: u.edgeId } : {}),
  });
}

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
 * cadence. S2 steps the class ladder off the freshly-folded use; S3 then steps the crossing-tier
 * ladder (upgraded spans + the corridor log a promoted trail earns) through the store.
 */
export class RoadEvolutionSystem implements System {
  readonly name = 'road-evolution';
  /** 0.1 Hz — a coarse heartbeat; the real cadence is the years-gate in advanceRoadEvolution. */
  readonly tickHz = 0.1;

  constructor(
    private readonly getRoadUse: () => RoadUseTally | null = () => null,
    private readonly getCohorts: () => ReadonlyMap<string, SettlementCohorts> | null = () => null,
    /** S3: the crossing-tier store. Optional so headless/pre-S3 states run without one. */
    private readonly getCrossingTiers: () => CrossingTierStore | null = () => null,
    /** S3: the trample grid — corridor-log detection scans its promoted cells. */
    private readonly getTrample: () => TrampleGrid | null = () => null,
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
      const useInputs = buildRoadUseInputs(map, { residents: residentsByPoi(ctx.world, cohorts), cohorts });
      foldRoadUse(graph, tally, ctx.now, useInputs);
      // S2: on the SAME year-pass, the freshly-folded use drives the class ladder — one apply,
      // hysteresis/streaks in edge.use. A surface flip re-rasters its tiles; each move narrates.
      const transitions = evolveRoadClasses(graph, buildRoadClassInputs(map, ctx.world, useInputs.wealthFor));
      if (transitions.length) {
        applyRoadClassSurface(map, transitions);
        for (const tr of transitions) emitRoadClassEvent(ctx.log, tr);
      }
      // S3: the crossing-tier ladder steps on the SAME year-pass, after the class apply (the
      // crossing reads the class the road just earned — LAG discipline in tierForUse). Seated
      // graph crossings step toward their earned tier; promoted trample corridors earn their
      // tier-0 log. Each physical change swaps the span entity and narrates.
      const store = this.getCrossingTiers();
      if (store) {
        const trample = this.getTrample();
        const upgrades = stepCrossingTiers({
          world: ctx.world, map, store, nowTick: ctx.now,
          wealthFor: useInputs.wealthFor,
          corridorSites: trample ? corridorSitesFor(map, trample, detectCorridorCrossings) : undefined,
        });
        for (const u of upgrades) emitCrossingUpgraded(ctx.log, u);
      }
    }
  }
}
