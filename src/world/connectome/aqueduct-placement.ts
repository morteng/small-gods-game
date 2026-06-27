// src/world/connectome/aqueduct-placement.ts
//
// G6 slice 3 — the EMERGENT trigger: aqueducts pop out of the connectome, they are not authored.
// A river is hydrology's output; an aqueduct appears when a settlement needs water it cannot easily
// reach and a HIGHLAND water source sits above it. This module is the pure selection core: given the
// settlement sites, a set of candidate highland sources (river headwaters, perched lakes — extracted
// from the live river network by the worldgen adapter in slice 4), and the elevation field, it
// decides which settlements get an aqueduct, from which source, and along which line — routing each
// candidate through `routeAqueduct` and keeping only the feasible, cheapest one per settlement.
//
// Pure + deterministic (settlements and sources are processed in a fixed, id/coord-sorted order; no
// RNG, no I/O). It owns no rendering and no graph mutation — it returns PLANS the adapter realises.

import { routeAqueduct, type AqueductRouteOptions } from './aqueduct-route';
import type { AqueductProfile } from './aqueduct-profile';
import type { SpanPoint } from './road-span';

/** A settlement that may demand water (the aqueduct sink). */
export interface SettlementSite {
  id: string;
  x: number;
  y: number;
}

/** A candidate highland water source (the aqueduct intake) — a river headwater or a perched lake
 *  shore, as found by the worldgen adapter. */
export interface WaterSource {
  id: string;
  x: number;
  y: number;
}

/** A realisable aqueduct the adapter can build: which source feeds which settlement, the routed
 *  line, and its ground-truth profile. */
export interface AqueductPlan {
  sourceId: string;
  settlementId: string;
  source: SpanPoint;
  sink: SpanPoint;
  route: SpanPoint[];
  profile: AqueductProfile;
  /** Total metres of trench + deck the channel needs (the cheaper, the more "natural" the line). */
  structuralCostM: number;
}

export interface AqueductPlacementOptions
  extends Omit<AqueductRouteOptions, 'blocked'> {
  /** A tile the channel may not route through (open water body, building). Optional. */
  blocked?: (x: number, y: number) => boolean;
  /** A source must sit at least this much higher than a settlement to feed it by gravity (metres).
   *  Default 6 m — enough fall to be worth building. */
  minHeadM?: number;
  /** Skip a source whose straight-line tile distance to a settlement exceeds this (a routing budget
   *  guard — aqueducts are costly, not arbitrarily long). Default 80 tiles. */
  maxRouteTiles?: number;
  /** Only the nearest N in-range sources per settlement are actually routed (bounds A* calls on a
   *  source-rich map). Default 4. */
  maxCandidatesPerSettlement?: number;
  /** Demand gate: return false for a settlement that does NOT need an aqueduct (already on a river,
   *  too small, …). The worldgen adapter supplies the real demand model; defaults to "all demand". */
  needsAqueduct?: (s: SettlementSite) => boolean;
}

/** Total trench + deck length the channel incurs along its profile, in metres (surface tiles cost
 *  nothing). Lower ⇒ a more contour-hugging, cheaper, more natural line. */
function structuralCostOf(profile: AqueductProfile): number {
  let m = 0;
  for (const s of profile.stations) {
    if (s.mode !== 'surface') m += Math.abs(s.clearM);
  }
  return m;
}

/**
 * Choose the emergent aqueducts for a world. For each settlement that needs water, consider the
 * highland sources that sit far enough above it and near enough to reach, route the nearest few, and
 * keep the single feasible line with the LEAST trenching+arching. Returns one plan per served
 * settlement (a settlement with no feasible source gets none), in a deterministic order.
 */
export function planAqueducts(
  settlements: SettlementSite[],
  sources: WaterSource[],
  opts: AqueductPlacementOptions,
): AqueductPlan[] {
  const minHeadM = opts.minHeadM ?? 6;
  const maxRouteTiles = opts.maxRouteTiles ?? 80;
  const maxCandidates = opts.maxCandidatesPerSettlement ?? 4;
  const needs = opts.needsAqueduct ?? (() => true);
  const reliefM = opts.reliefM;
  const elevM = (p: { x: number; y: number }) => opts.elevAt(p.x, p.y) * reliefM;

  // Deterministic iteration order, independent of caller array order.
  const sortedSettlements = [...settlements].sort(byIdThenCoord);
  const sortedSources = [...sources].sort(byIdThenCoord);

  const plans: AqueductPlan[] = [];
  for (const s of sortedSettlements) {
    if (!needs(s)) continue;
    const sinkElev = elevM(s);

    // In-range, high-enough sources, nearest first (ties broken by id for determinism).
    const candidates = sortedSources
      .filter((src) => elevM(src) - sinkElev >= minHeadM)
      .map((src) => ({ src, d: Math.abs(src.x - s.x) + Math.abs(src.y - s.y) }))
      .filter((c) => c.d <= maxRouteTiles)
      .sort((a, b) => a.d - b.d || cmp(a.src.id, b.src.id))
      .slice(0, maxCandidates);

    let best: AqueductPlan | null = null;
    for (const { src } of candidates) {
      const r = routeAqueduct({ x: src.x, y: src.y }, { x: s.x, y: s.y }, opts);
      if (!r || !r.profile.feasible) continue;
      const cost = structuralCostOf(r.profile);
      if (!best || cost < best.structuralCostM) {
        best = {
          sourceId: src.id, settlementId: s.id,
          source: { x: src.x, y: src.y }, sink: { x: s.x, y: s.y },
          route: r.path, profile: r.profile, structuralCostM: cost,
        };
      }
    }
    if (best) plans.push(best);
  }
  return plans;
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function byIdThenCoord(a: { id: string; x: number; y: number }, b: { id: string; x: number; y: number }): number {
  return cmp(a.id, b.id) || a.x - b.x || a.y - b.y;
}
