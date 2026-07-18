import type { World } from '@/world/world';
import type { SimClock } from '@/core/clock';
import type { Rng } from '@/core/rng';
import type { EventLog } from '@/core/events';
import { queryNpcs, NPC_KIND } from '@/world/npc-helpers';
import { killNpc, materializeSynthChild } from '@/world/npc-lifecycle';
import { projectTurnover } from '@/sim/turnover';
import { TICKS_PER_YEAR } from '@/sim/mortality';
import { countPlayerBelievers } from '@/sim/believers';
import { growSettlementsOnSkip, residentsByPoi } from '@/sim/systems/settlement-growth-system';
import { advanceRoadEvolution, connectomeEvolveOptions, buildRoadUseInputs, applyRoadClassSurface } from '@/world/road-evolution';
import { projectRoadClassesOverSkip } from '@/world/road-use';
import { buildRoadClassInputs, emitRoadClassEvent, emitCrossingUpgraded } from '@/sim/systems/road-evolution-system';
import { stepCrossingTiers, corridorSitesFor, type CrossingTierStore, type CrossingUpgrade } from '@/world/crossing-tier-store';
import { detectCorridorCrossings } from '@/world/corridor-crossings';
import { getClimateFields } from '@/world/heightfield';
import type { TrampleGrid } from '@/sim/trample';

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
  trample?: TrampleGrid | null,
  crossingTiers?: CrossingTierStore | null,
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

  // Catch settlement housing up to the post-skip population — the live growth
  // system can't tick during a closed-form jump, so grow deterministically to
  // the end-state it would have converged to (S5).
  // Trample grid rides along so skip growth honours the same social gravity as live growth.
  growSettlementsOnSkip(world, rng, fromTick, log, trample);

  const toTick = fromTick + years * TICKS_PER_YEAR;
  clock.setNow(toTick);

  // Roads age across the jump too: the evolution system can't tick during a closed-form skip,
  // so advance the graph's dynamics to the post-skip tick deterministically — measured against
  // the POST-skip population (deaths/births + settlement growth already applied above), so roads
  // to settlements that emptied over the era decay while roads to ones that grew stay kept.
  if (world.tiles.roadGraph) {
    const graph = world.tiles.roadGraph;
    const residents = residentsByPoi(world);
    advanceRoadEvolution(graph, toTick, connectomeEvolveOptions(world.tiles, {
      residents,
      climate: getClimateFields(world.tiles),
    }));
    // Roads also climb/fall the CLASS ladder across the era (S2). No tick measured live footfall,
    // so use is driven by inferred structural importance and the ladder sub-steps at the year-pass
    // resolution — a busy era-long route promotes as live-ticking those years would. Net per-edge
    // transitions narrate as an era of road-building; a stone-paving flip re-rasters its tiles.
    // (No cohort tier here → wealth reads the neutral prosperity — the skip is an approximation.)
    const useInputs = buildRoadUseInputs(world.tiles, { residents });
    // S3: crossings ladder up across the era too, riding the SAME sub-step schedule via the
    // onSubStep hook — the tier streaks see the interleaved fold→apply cadence live ticking
    // produces (exact parity), and entity swaps land as the sub-steps cross their thresholds.
    // Corridor sites are detected ONCE (the trample grid is static across a closed-form jump);
    // upgrades are COLLAPSED to one net event per crossing (first `from`, last `to`).
    const netUpgrades = new Map<string, CrossingUpgrade>();
    const sites = crossingTiers && trample
      ? corridorSitesFor(world.tiles, trample, detectCorridorCrossings) : undefined;
    const transitions = projectRoadClassesOverSkip(
      graph, fromTick, toTick, useInputs, buildRoadClassInputs(world.tiles, world, useInputs.wealthFor),
      crossingTiers ? (now) => {
        for (const u of stepCrossingTiers({
          world, map: world.tiles, store: crossingTiers, nowTick: now,
          wealthFor: useInputs.wealthFor, corridorSites: sites,
        })) {
          const prev = netUpgrades.get(u.crossingId);
          netUpgrades.set(u.crossingId, prev ? { ...u, from: prev.from } : u);
        }
      } : undefined,
    );
    if (transitions.length) {
      applyRoadClassSurface(world.tiles, transitions);
      for (const tr of transitions) emitRoadClassEvent(log, tr);
    }
    for (const u of netUpgrades.values()) emitCrossingUpgraded(log, u);
  }

  const believersAfter = countPlayerBelievers(world);

  const summary: SkipSummary = {
    fromTick, toTick, years,
    deaths: deaths.length, births: births.length,
    believersBefore, believersAfter,
  };
  log.append({ type: 'era_skipped', ...summary });
  return summary;
}
