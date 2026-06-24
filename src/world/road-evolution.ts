// src/world/road-evolution.ts
//
// Road TIME-EVOLUTION (design doc 2026-06-24 "Road as a connectome projection", §time).
//
// A road is not static: it ages, wears under traffic and weather, is repaired when its
// settlement keeps it up, and is reclaimed by vegetation when it is not. This module is the
// PURE, deterministic stepping model over `RoadDynamics` (the time-varying half of RoadState).
// It mutates `edge.dynamics` in place and bumps `graph.rev` so the carve + surface caches
// re-derive (see road-deformation `key`, road-surface cache key).
//
//   condition  ← degrades by traffic+weather, repaired by upkeep  (the maintenance balance)
//   wear       ← integrates use minus upkeep                       (rut depth, edge softening)
//   overgrowth ← grows on a neglected low-condition road, cleared by traffic + upkeep
//   ageYears   ← monotonic time
//
// No Math.random (sim determinism). The same graph + same elapsed years + same upkeep ⇒ the
// same dynamics, so it is replay-safe and composes with the D2 deterministic time-skip.

import type { RoadGraph, RoadEdge, RoadClass } from '@/world/road-graph';
import type { RoadDynamics } from '@/world/road-state';
import { clamp01 } from '@/core/math';
import { TICKS_PER_DAY, DAYS_PER_YEAR } from '@/core/calendar';

/** Per-year rates. Tuned so a kept highway stays pristine and a neglected path ruins in ~50y. */
export const ROAD_EVOLUTION_RATES = {
  /** Condition lost per year at full traffic (potholing, surface break-up). */
  trafficWear: 0.04,
  /** Condition lost per year at full climate aggression (rain, frost-heave). */
  weather: 0.02,
  /** Condition regained per year at full upkeep (patching, regravelling). */
  repair: 0.08,
  /** Wear integrated per year at full traffic. */
  wearAccrual: 0.015,
  /** Overgrowth gained per year on a fully neglected, fully ruined road. */
  overgrow: 0.05,
  /** Overgrowth cleared per year at full traffic (trampling) / full upkeep (clearing). */
  trample: 0.06,
} as const;

/** Default climate aggression when the caller has no per-edge climate sample. */
const DEFAULT_CLIMATE = 0.5;

export interface RoadStepContext {
  /** Elapsed sim years for this step (may be large for a time-skip). */
  dtYears: number;
  /** Maintenance investment 0..1 the settlement spends on this road (connectome signal). */
  upkeep: number;
  /** Use intensity 0..1. Suppresses overgrowth, drives wear. */
  traffic: number;
  /** Weather aggression 0..1 (wetness/freeze). Defaults to {@link DEFAULT_CLIMATE}. */
  climate?: number;
}

/** Class → a default upkeep 0..1: a trunk road is state-maintained, a wilderness path gets
 *  essentially no crew upkeep — it stays open only through the foot traffic (the traffic term). */
const CLASS_UPKEEP: Record<RoadClass, number> = { highway: 0.9, road: 0.5, track: 0.18, path: 0.04 };
/** Class → a default traffic 0..1 when the connectome carries no measured flow yet. */
const CLASS_TRAFFIC: Record<RoadClass, number> = { highway: 0.9, road: 0.6, track: 0.35, path: 0.2 };

/** A new, freshly-built road: pristine, unworn, no overgrowth. */
export function freshDynamics(): Required<RoadDynamics> {
  return { ageYears: 0, condition: 1, traffic: 0, wear: 0, overgrowth: 0 };
}

/** Fill a (possibly partial / absent) dynamics with concrete starting values. */
function materialize(d: RoadDynamics | undefined, traffic: number): Required<RoadDynamics> {
  return {
    ageYears: Math.max(0, d?.ageYears ?? 0),
    condition: clamp01(d?.condition ?? 1),
    traffic: clamp01(d?.traffic ?? traffic),
    wear: clamp01(d?.wear ?? 0),
    overgrowth: clamp01(d?.overgrowth ?? 0),
  };
}

/**
 * Step one road's dynamics forward by `dtYears`. Large steps are integrated in ≤1-year
 * sub-steps so the state-dependent terms (overgrowth depends on condition, which is moving)
 * stay stable and a single jump-N-years call matches an N-times-stepped one closely.
 */
export function stepRoadDynamics(prev: RoadDynamics | undefined, ctx: RoadStepContext): Required<RoadDynamics> {
  const traffic = clamp01(ctx.traffic);
  const upkeep = clamp01(ctx.upkeep);
  const climate = clamp01(ctx.climate ?? DEFAULT_CLIMATE);
  const R = ROAD_EVOLUTION_RATES;

  const s = materialize(prev, traffic);
  s.traffic = traffic;

  let remaining = Math.max(0, ctx.dtYears);
  // Cap sub-steps so a pathological dtYears can't spin forever; 0.5y resolution past that.
  const MAX_SUBSTEPS = 4000;
  let steps = 0;
  while (remaining > 1e-9 && steps < MAX_SUBSTEPS) {
    const dt = Math.min(1, remaining);
    remaining -= dt;
    steps++;

    const degrade = dt * (R.trafficWear * traffic + R.weather * climate);
    const heal = dt * R.repair * upkeep;
    s.condition = clamp01(s.condition - degrade + heal);

    s.wear = clamp01(s.wear + dt * (R.wearAccrual * traffic) - dt * R.repair * upkeep);

    const growth = dt * R.overgrow * (1 - traffic) * (1 - s.condition);
    const clearing = dt * (R.trample * traffic + R.repair * upkeep);
    s.overgrowth = clamp01(s.overgrowth + growth - clearing);

    s.ageYears += dt;
  }
  return s;
}

/**
 * A repair / rebuild event: restores the surface. A patch (default) keeps the road's age but
 * resets condition and clears overgrowth; a full rebuild also zeroes age + wear.
 */
export function repairRoad(prev: RoadDynamics | undefined, opts: { rebuild?: boolean } = {}): Required<RoadDynamics> {
  const s = materialize(prev, 0);
  return {
    ageYears: opts.rebuild ? 0 : s.ageYears,
    condition: 1,
    traffic: s.traffic,
    wear: opts.rebuild ? 0 : clamp01(s.wear * 0.25),
    overgrowth: 0,
  };
}

export interface EvolveOptions {
  /** Per-edge upkeep 0..1; defaults to the edge's class upkeep. */
  upkeepFor?: (edge: RoadEdge) => number;
  /** Per-edge traffic 0..1; defaults to the edge's class traffic. */
  trafficFor?: (edge: RoadEdge) => number;
  /** Per-edge climate aggression 0..1; defaults to {@link DEFAULT_CLIMATE}. */
  climateFor?: (edge: RoadEdge) => number;
}

/**
 * Evolve every road edge in the graph forward by `dtYears`, mutating `edge.dynamics` and
 * bumping `graph.rev` (so the carve + surface re-derive). Non-road edges (rivers/walls) are
 * left untouched. Returns the same graph for chaining. Deterministic.
 */
export function evolveRoadGraph(graph: RoadGraph, dtYears: number, opts: EvolveOptions = {}): RoadGraph {
  if (dtYears <= 0) return graph;
  for (const edge of graph.edges) {
    if (edge.feature !== 'road') continue;
    const upkeep = opts.upkeepFor?.(edge) ?? CLASS_UPKEEP[edge.class];
    const traffic = opts.trafficFor?.(edge) ?? CLASS_TRAFFIC[edge.class];
    const climate = opts.climateFor?.(edge);
    edge.dynamics = stepRoadDynamics(edge.dynamics, { dtYears, upkeep, traffic, climate });
  }
  graph.rev = (graph.rev ?? 0) + 1;
  return graph;
}

/** Sim ticks per in-game year. */
const TICKS_PER_YEAR = TICKS_PER_DAY * DAYS_PER_YEAR;
/** Don't re-derive the carve/surface more often than this many in-game years. */
export const ROAD_EVOLUTION_MIN_APPLY_YEARS = 0.5;

/**
 * Advance a graph's dynamics to sim tick `now`, using the graph's own persisted clock
 * (`evolvedAtTick`). Stateless + replay/save-safe: the graph carries the baseline, so the
 * caller (live tick system OR the D2 time-skip) need hold no state. No-op (no rev bump) until
 * at least {@link ROAD_EVOLUTION_MIN_APPLY_YEARS} have elapsed, so the expensive re-derivation
 * runs at most ~twice per in-game year. Returns the years actually applied (0 if skipped).
 */
export function advanceRoadEvolution(graph: RoadGraph, now: number, opts: EvolveOptions = {}): number {
  const baseline = graph.evolvedAtTick ?? now;
  const dtYears = (now - baseline) / TICKS_PER_YEAR;
  if (graph.evolvedAtTick === undefined) { graph.evolvedAtTick = now; return 0; } // first sight: start fresh
  if (dtYears < ROAD_EVOLUTION_MIN_APPLY_YEARS) return 0;
  evolveRoadGraph(graph, dtYears, opts);
  graph.evolvedAtTick = now;
  return dtYears;
}
