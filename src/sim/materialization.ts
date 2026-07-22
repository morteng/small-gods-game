/**
 * P2 living-population — pure MATERIALIZATION helpers (rng-free; guarded by
 * tests/unit/no-random-in-sim.test.ts). The band-mean synthesis + the
 * removeSoul/drawCount draw loop live in cohorts.ts (`bandMeanObservation` /
 * `drawCohortSouls` — the single cohort choke point); this module holds the
 * NON-cohort-mutating helpers: read an entity's current observation for
 * fold-back, size a settlement's resident capacity, and turn an occupancy plan
 * into an ordered slot list with land-snapped home tiles.
 */

import type { Entity, EntityId, GameMap } from '@/core/types';
import type { SoulObservation } from '@/sim/cohorts';
import { npcProps } from '@/world/npc-helpers';
import { ageInYears } from '@/sim/mortality';
import { snapToLand } from '@/world/land-snap';
import {
  settlementDraws, planResidents, residentCapacity, type OccupancyPlan,
} from '@/sim/population/settlement-demand';
import type { BuildingDraw } from '@/sim/population/building-capacity';

/** A currently-materialized extra: its id, home settlement, and origin band. */
export interface MaterializedRef {
  id: EntityId;
  poiId: string;
  bandIndex: number;
}

/**
 * The observation a live extra folds back into its cohort — its CURRENT belief
 * and needs (which may have DRIFTED under divine attention while materialized),
 * so `addSoul` banks exactly the belief the soul accrued. Age is derived from
 * birthTick, never stored.
 */
export function foldObservation(e: Entity, now: number): SoulObservation {
  const p = npcProps(e);
  return {
    age: ageInYears(p.birthTick, now),
    beliefs: structuredClone(p.beliefs),
    needs: { ...p.needs },
  };
}

/** Total resident slots the focused settlement's dwellings offer (derived, no
 *  authored field) — one of the three caps on the materialization target. */
export function residentCapacityForPoi(map: GameMap, poiId: string): number {
  return residentCapacity(settlementDraws(map, poiId));
}

/** Expand a residents occupancy plan into an ORDERED slot list (each dwelling
 *  repeated by its assigned count, in sorted-building order): slot k is where
 *  the k-th materialized resident lives. Stable across ticks for a fixed plan,
 *  so LIFO fold-back keeps indices consistent. */
export function occupancySlots(draws: BuildingDraw[], plan: OccupancyPlan): BuildingDraw[] {
  const byId = new Map(draws.map(d => [d.buildingId, d]));
  const slots: BuildingDraw[] = [];
  for (const id of [...plan.byBuilding.keys()].sort()) {
    const d = byId.get(id);
    const n = plan.byBuilding.get(id) ?? 0;
    if (!d) continue;
    for (let k = 0; k < n; k++) slots.push(d);
  }
  return slots;
}

/** The land-snapped home tile for a resident slot (byte-identical to the
 *  spawner's door → snapToLand step). */
export function homeTileFor(draw: BuildingDraw, map: GameMap): { x: number; y: number } {
  return snapToLand(map, draw.doorX, draw.doorY);
}

/** Convenience: the ordered resident slots for a settlement at a given budget. */
export function residentSlots(map: GameMap, poiId: string, budget: number): BuildingDraw[] {
  const draws = settlementDraws(map, poiId);
  return occupancySlots(draws, planResidents(draws, budget));
}
