/**
 * P2 living-population — the DEMAND / apportionment layer. Given a settlement's
 * buildings (their derived capacities) and a materialization budget, spread the
 * live extras across homes (slice 1), workplaces (slice 2) and attractors
 * (slice 3) via the shared largest-remainder `apportion`, each building capped
 * at its declared slot count.
 *
 * Pure + rng-free: no cohort mutation, no world mutation — it produces PLANS the
 * MaterializationSystem consumes. (unified spec shared_seams: plan logic lives
 * here, never in cohorts.ts.)
 */

import type { GameMap } from '@/core/types';
import { apportion } from '@/sim/cohorts';
import { resolveBuildingDraw, type BuildingDraw } from '@/sim/population/building-capacity';

/** Which capacity dimension an occupancy pass fills. */
export type OccupancyDim = 'residents' | 'workers';

export interface OccupancyPlan {
  /** buildingId → souls assigned. */
  byBuilding: Map<string, number>;
  /** Σ over byBuilding. */
  total: number;
}

// ── Slice-3 visitor/market seam (facts-only; unused in slice 1) ───────────────
/** Fraction of a settlement's own population pulled to attractor buildings. */
export const LOCAL_VISITOR_FRAC = 0.15;
/** Fraction of a road-graph neighbour's population pulled on a market day. */
export const MARKET_PULL_FRAC = 0.05;
/** Market fires every N days (integer dayIndex gate — no wall clock). */
export const MARKET_DAY_INTERVAL_DAYS = 7;
/** Road-graph hop radius for neighbour market pull. */
export const MARKET_PULL_MAX_HOPS = 1;

/**
 * A settlement's building capacity draws, sorted by building id (deterministic
 * apportionment order). Reads `map.buildings` filtered by `poiId` — the exact
 * seam spawner.ts uses for resident placement.
 */
export function settlementDraws(map: GameMap, poiId: string): BuildingDraw[] {
  const out: BuildingDraw[] = [];
  for (const b of map.buildings ?? []) {
    if (b.poiId !== poiId) continue;
    const d = resolveBuildingDraw(b);
    if (d) out.push(d);
  }
  return out.sort((a, b) => (a.buildingId < b.buildingId ? -1 : a.buildingId > b.buildingId ? 1 : 0));
}

/**
 * Spread `budget` souls over the draws' capacity in dimension `dim`, each
 * building capped at its declared slot count, via largest-remainder `apportion`
 * (index tiebreak). Deterministic; sums to `min(budget, Σ capacity)`.
 */
export function apportionOccupancy(
  draws: BuildingDraw[], budget: number, dim: OccupancyDim,
): Map<string, number> {
  const out = new Map<string, number>();
  const caps = draws.map(d => Math.max(0, Math.round(d[dim])));
  const total = caps.reduce((a, c) => a + c, 0);
  if (budget <= 0 || total <= 0) { for (const d of draws) out.set(d.buildingId, 0); return out; }
  // budget ≥ Σcap ⇒ everyone at capacity; else largest-remainder over caps
  // (which, since weights ARE the caps and budget < Σcap, never exceeds a cap).
  const alloc = budget >= total ? caps : apportion(budget, caps);
  draws.forEach((d, i) => out.set(d.buildingId, alloc[i]));
  return out;
}

/** Residents-only occupancy plan (slice 1): fill homes up to `budget`. */
export function planResidents(draws: BuildingDraw[], budget: number): OccupancyPlan {
  const dwellings = draws.filter(d => d.residents > 0);
  const byBuilding = apportionOccupancy(dwellings, budget, 'residents');
  let total = 0;
  for (const n of byBuilding.values()) total += n;
  return { byBuilding, total };
}

/** Total resident slots a settlement's dwellings offer. */
export function residentCapacity(draws: BuildingDraw[]): number {
  let n = 0;
  for (const d of draws) n += Math.max(0, Math.round(d.residents));
  return n;
}
