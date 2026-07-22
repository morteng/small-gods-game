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
import { snapToLand } from '@/world/land-snap';

/** Which capacity dimension an occupancy pass fills. */
export type OccupancyDim = 'residents' | 'workers';

export interface OccupancyPlan {
  /** buildingId → souls assigned. */
  byBuilding: Map<string, number>;
  /** Σ over byBuilding. */
  total: number;
}

// ── Slice-3 visitor / market seam ─────────────────────────────────────────────
/** Fraction of a settlement's own population pulled to attractor buildings. */
export const LOCAL_VISITOR_FRAC = 0.15;
/** Fraction of a road-graph neighbour's population pulled on a market day. */
export const MARKET_PULL_FRAC = 0.05;
/** Market fires every N days (integer dayIndex gate — no wall clock). */
export const MARKET_DAY_INTERVAL_DAYS = 7;
/** Road-graph hop radius for neighbour market pull. */
export const MARKET_PULL_MAX_HOPS = 1;
/** Market is open (visitors gather) over [open, close) solar hours. */
export const MARKET_OPEN_HOUR = 8;
export const MARKET_CLOSE_HOUR = 17;
/** Ceiling on simultaneously-materialized visitors at one host (frame-cost + crowd). */
export const VISITOR_CAP = 24;
/** Ceiling on the everyday local-bustle crowd (leaves headroom for the market-day surge). */
export const LOCAL_VISITOR_MAX = 12;
/** Ceiling on visitors pulled from any ONE road-neighbour on a market day. */
export const NEIGHBOUR_VISITOR_MAX = 6;

/** True while the market is open (visitors mill). Pure hour gate. */
export function isMarketHour(solarHour: number): boolean {
  return solarHour >= MARKET_OPEN_HOUR && solarHour < MARKET_CLOSE_HOUR;
}

/** Stable per-settlement market-day phase (0..INTERVAL-1) so towns stagger their
 *  markets across the week rather than all trading on the same day. Same 31-mul
 *  hash the spawner/materializer mint ids with; rng-free. */
function marketPhase(poiId: string): number {
  let h = 0;
  for (let i = 0; i < poiId.length; i++) h = (Math.imul(31, h) + poiId.charCodeAt(i)) | 0;
  return Math.abs(h) % MARKET_DAY_INTERVAL_DAYS;
}

/** True on `poiId`'s weekly market day. Integer dayIndex gate (no wall clock). */
export function isMarketDay(poiId: string, dayIndex: number): boolean {
  const d = ((dayIndex % MARKET_DAY_INTERVAL_DAYS) + MARKET_DAY_INTERVAL_DAYS) % MARKET_DAY_INTERVAL_DAYS;
  return d === marketPhase(poiId);
}

/** Attractor pull capacity — Σ `visitorDraw` over a settlement's buildings
 *  (market_stall/tavern/well/shrine…). 0 ⇒ the town has no gathering places, so
 *  no visitors materialize there. */
export function attractorCapacity(draws: BuildingDraw[]): number {
  let n = 0;
  for (const d of draws) n += Math.max(0, Math.round(d.visitorDraw));
  return n;
}

/** Everyday local bustle: a fraction of the host's OWN population, capped by its
 *  attractor capacity and the local ceiling. 0 when the town has no attractors. */
export function localVisitorTarget(ownPop: number, draws: BuildingDraw[]): number {
  const cap = attractorCapacity(draws);
  if (cap <= 0) return 0;
  return Math.min(Math.round(LOCAL_VISITOR_FRAC * Math.max(0, ownPop)), cap, LOCAL_VISITOR_MAX);
}

/** Market-day pull from ONE road-neighbour's population, per-neighbour capped. */
export function neighbourVisitorTarget(neighbourPop: number): number {
  return Math.min(Math.round(MARKET_PULL_FRAC * Math.max(0, neighbourPop)), NEIGHBOUR_VISITOR_MAX);
}

/** The market gathering tile of a settlement: the well at the green's heart when
 *  one exists, else the mid tile of the widened market street, else the founding
 *  node, else the POI centre. Land-snapped so a spawn lands on walkable ground.
 *  null when the poi is unknown to the map. */
export function marketAnchorTile(map: GameMap, poiId: string): { x: number; y: number } | null {
  let tile: { x: number; y: number } | null = null;
  const plan = map.settlementPlans?.find(p => p.poiId === poiId);
  if (plan) {
    const well = plan.civics?.find(c => c.type === 'well');
    if (well) tile = { x: well.x + Math.floor(well.w / 2), y: well.y + Math.floor(well.h / 2) };
    else if (plan.market?.length) tile = plan.market[Math.floor(plan.market.length / 2)];
    else tile = plan.center;
  }
  if (!tile) {
    const pos = map.worldSeed?.pois?.find(q => q.id === poiId)?.position;
    if (pos) tile = { x: pos.x, y: pos.y };
  }
  if (!tile) return null;
  return snapToLand(map,
    Math.max(0, Math.min(map.width - 1, Math.round(tile.x))),
    Math.max(0, Math.min(map.height - 1, Math.round(tile.y))));
}

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
