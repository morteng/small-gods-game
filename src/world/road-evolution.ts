// src/world/road-evolution.ts
//
// Road TIME-EVOLUTION (design doc 2026-06-24 "Road as a connectome projection", §time).
//
// A road is not static: it ages, wears under traffic and weather, is repaired when its
// settlement keeps it up, and is reclaimed by vegetation when it is not. This module is the
// PURE, deterministic stepping model over `RoadDynamics` (the time-varying half of RoadState).
// It mutates `edge.dynamics` in place and bumps `graph.rev` so the carve + surface caches
// re-derive (see road-deformation `key`, feature-geometry road cache key).
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
import type { RoadUseFoldInputs, RoadClassTransition } from '@/world/road-use';
import type { GameMap, POI } from '@/core/types';
import type { ClimateFields } from '@/world/heightfield';
import type { SettlementCohorts } from '@/sim/cohorts';
import { cohortMeanProsperity } from '@/sim/cohorts';
import { terrainContextFrom, weatherAggression } from '@/world/terrain-context';
import { clamp01 } from '@/core/math';
import { WATER_TYPES } from '@/core/constants';
import { bumpTilesRev } from '@/core/tile-rev';
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

// ── Connectome-driven upkeep/traffic: a road is kept up by its endpoint settlements ──
// Importance/size set a settlement's static CEILING; LIVE resident count (settlement-growth's
// residentsByPoi) sets how much of that ceiling is realised. A road decays because its endpoint
// EMPTIED — measured against what that place was built to hold — true time-varying emergence.

const IMPORTANCE_LEVEL: Record<string, number> = { low: 0.1, medium: 0.4, high: 0.7, critical: 1 };
const SIZE_LEVEL: Record<string, number> = { small: 0.12, medium: 0.45, large: 0.75, huge: 1 };

/** A settlement's STATIC ceiling, 0..1: a hamlet (low/small ≈ 0.11) barely keeps its track
 *  passable, a capital (critical/huge = 1) keeps a highway pristine. */
function staticCapacity(p: POI | undefined): number {
  if (!p) return 0.18;
  const imp = IMPORTANCE_LEVEL[p.importance ?? 'medium'] ?? 0.4;
  const sz = SIZE_LEVEL[p.size ?? 'medium'] ?? 0.45;
  return clamp01(0.6 * imp + 0.4 * sz);
}

/** The resident count a settlement of this importance/size is built to hold — the baseline live
 *  population is measured AGAINST, so decline is relative to what the place once was (~3 for a
 *  hamlet → ~48 for a capital). */
function expectedPopulation(p: POI | undefined): number {
  if (!p) return 4;
  const imp = IMPORTANCE_LEVEL[p.importance ?? 'medium'] ?? 0.4;
  const sz = SIZE_LEVEL[p.size ?? 'medium'] ?? 0.45;
  return 3 + 45 * (0.6 * imp + 0.4 * sz);
}

/** A settlement's capacity to maintain/use a road, 0..1. Without a live census this is the static
 *  ceiling; WITH one, the ceiling is scaled by how peopled the place is relative to its baseline —
 *  an emptied town lets its roads rot (floor 0.2× keeps stone from ruining on a single lean year),
 *  a thriving one keeps them to the class ceiling. */
function poiVitality(p: POI | undefined, residents?: Map<string, number>): number {
  const cap = staticCapacity(p);
  if (!residents) return cap;
  const live = p ? (residents.get(p.id) ?? 0) : 0;
  const popFactor = clamp01(live / expectedPopulation(p));
  return cap * (0.2 + 0.8 * popFactor);
}

/** Climate aggression 0..1 at an edge's midpoint, via the shared object↔terrain seam: wet ground
 *  (rain) + frost (snow-cold heave) weather a road faster. A dry temperate road sits near the
 *  {@link DEFAULT_CLIMATE} baseline; a cold wet upland road approaches 1. Shares the snow/mud/rain
 *  definition with every other object that dresses to its ground (see terrain-context). */
function edgeClimateAggression(edge: RoadEdge, climate: ClimateFields, w: number, h: number): number {
  const line = edge.polyline;
  if (!line.length) return DEFAULT_CLIMATE;
  const mid = line[line.length >> 1];
  const cx = Math.max(0, Math.min(w - 1, Math.round(mid.x)));
  const cy = Math.max(0, Math.min(h - 1, Math.round(mid.y)));
  const i = cy * w + cx;
  return weatherAggression(terrainContextFrom(climate.moisture[i] ?? 0.5, climate.temperature[i] ?? 0.5));
}

/** Live connectome signals folded into road evolution. Both optional: with neither, evolution
 *  falls back to the static importance/size ceiling + a flat climate (the pre-live behaviour). */
export interface ConnectomeEvolveInputs {
  /** Living residents per POI id — `residentsByPoi(world)` from the settlement-growth system. */
  residents?: Map<string, number>;
  /** Per-tile moisture/temperature fields — `getClimateFields(map)`. */
  climate?: ClimateFields;
}

/**
 * Build {@link EvolveOptions} that draw upkeep + traffic from a road's endpoint settlements, and
 * (when a climate is supplied) per-edge weather aggression from where the road runs:
 *  - **upkeep** = the MORE prosperous end (one rich patron is enough to keep a road),
 *  - **traffic** = the average vitality (flow needs both ends alive),
 *  - **climate** = wetness + frost sampled at the edge midpoint.
 * So a road between two thriving towns stays pristine, a road to a settlement that EMPTIED loses
 * upkeep AND traffic → it decays and greens over, and a cold/wet road wears faster than a dry one.
 * Edges with no POI at either end fall back to their class default. Deterministic; pure over inputs.
 */
/** Resolve an edge's two endpoint POIs (either may be undefined — a road end that isn't a
 *  settlement). Shared by the evolution opts and the road-use fold inputs so both read the
 *  same node→POI plumbing. */
function endpointPoisFor(map: GameMap): (edge: RoadEdge) => [POI | undefined, POI | undefined] {
  const graph = map.roadGraph;
  const nodeById = new Map((graph?.nodes ?? []).map((n) => [n.id, n]));
  const poiById = new Map((map.worldSeed?.pois ?? []).map((p) => [p.id, p]));
  return (edge) => [
    poiById.get(nodeById.get(edge.a)?.poiRef ?? ''),
    poiById.get(nodeById.get(edge.b)?.poiRef ?? ''),
  ];
}

/** Resolve an edge's two endpoint POI ids (either may be undefined). The road-class ladder (S2)
 *  reads these for its `road_promoted/demoted` events; shares the same node→POI plumbing. */
export function endpointPoiIdsFor(map: GameMap): (edge: RoadEdge) => [string | undefined, string | undefined] {
  const pois = endpointPoisFor(map);
  return (edge) => { const [a, b] = pois(edge); return [a?.id, b?.id]; };
}

export function connectomeEvolveOptions(map: GameMap, inputs: ConnectomeEvolveInputs = {}): EvolveOptions {
  const graph = map.roadGraph;
  if (!graph) return {};
  const { residents, climate } = inputs;
  const endpointPois = endpointPoisFor(map);
  const opts: EvolveOptions = {
    upkeepFor: (edge) => {
      const [a, b] = endpointPois(edge);
      if (!a && !b) return CLASS_UPKEEP[edge.class]; // no settlement signal → class default
      return Math.max(poiVitality(a, residents), poiVitality(b, residents));
    },
    trafficFor: (edge) => {
      const [a, b] = endpointPois(edge);
      if (!a && !b) return CLASS_TRAFFIC[edge.class];
      return clamp01(0.5 * (poiVitality(a, residents) + poiVitality(b, residents)));
    },
  };
  if (climate) {
    const w = map.width, h = map.height;
    opts.climateFor = (edge) => edgeClimateAggression(edge, climate, w, h);
  }
  return opts;
}

/** Live connectome signals the road-USE fold reads (road-wear economy S1). */
export interface RoadUseInputs {
  /** Living count per POI id — pass `residentsByPoi(world, cohorts)` so BOTH the named tier and
   *  the statistical cohort tier feed the traffic FLOOR (spec §2: both tiers must feed use). */
  residents?: Map<string, number>;
  /** Statistical cohorts per POI id — the prosperity "purse" behind the wealth term. */
  cohorts?: ReadonlyMap<string, SettlementCohorts>;
}

/**
 * Build the per-edge inputs the year-pass `foldRoadUse` reads: the inferred-traffic FLOOR
 * (endpoint vitality, so a pure-cohort route with no live footfall never reads as dead) and the
 * WEALTH term (endpoint prosperity gated by liveness — an emptied town keeps no purse). Reuses
 * the SAME endpoint-POI + vitality plumbing as `connectomeEvolveOptions` — no forked logic.
 */
export function buildRoadUseInputs(map: GameMap, inputs: RoadUseInputs = {}): RoadUseFoldInputs {
  const { residents, cohorts } = inputs;
  const endpointPois = endpointPoisFor(map);
  const wealthOf = (p: POI | undefined): number | null => {
    if (!p) return null;
    const sc = cohorts?.get(p.id);
    // liveness 0.2..1 (staticCapacity cancels out of poiVitality) — an emptied place has no purse
    // even if its remembered prosperity was high.
    const liveness = clamp01(poiVitality(p, residents) / staticCapacity(p));
    const prosperity = sc ? clamp01(cohortMeanProsperity(sc)) : 0.5; // neutral when no cohort tier
    return clamp01(prosperity * liveness);
  };
  return {
    trafficFloorFor: (edge) => {
      const [a, b] = endpointPois(edge);
      if (!a && !b) return CLASS_TRAFFIC[edge.class];
      return clamp01(0.5 * (poiVitality(a, residents) + poiVitality(b, residents)));
    },
    wealthFor: (edge) => {
      const [a, b] = endpointPois(edge);
      const present = [wealthOf(a), wealthOf(b)].filter((w): w is number => w !== null);
      return present.length ? clamp01(present.reduce((s, w) => s + w, 0) / present.length) : 0;
    },
  };
}

/**
 * Re-raster the tile TYPE of every edge whose S2 class transition flipped its surface dirt→stone
 * (`dirt_road` → `stone_road`), so the tile grid agrees with the graph the render ribbon already
 * re-derived off `graph.rev`. Bridge/water cells are left untouched (a stone road doesn't pave its
 * own crossing). Bumps `tilesRev` once iff any tile changed — the standing rule for a post-gen
 * `tile.type` write, so the terrain colour memo repaints. Returns the number of tiles re-stamped.
 */
export function applyRoadClassSurface(map: GameMap, transitions: RoadClassTransition[]): number {
  const graph = map.roadGraph;
  if (!graph) return 0;
  const byId = new Map(graph.edges.map((e) => [e.id, e]));
  let touched = 0;
  for (const tr of transitions) {
    if (!tr.surfaceChanged) continue;
    const edge = byId.get(tr.edgeId);
    if (!edge) continue;
    const want = edge.surface === 'stone' ? 'stone_road' : 'dirt_road';
    for (const c of edge.polyline) {
      const t = map.tiles[c.y]?.[c.x];
      if (!t || t.type === 'bridge' || WATER_TYPES.has(t.type)) continue;
      if (t.type !== want) { t.type = want; t.walkable = true; touched++; }
    }
  }
  if (touched) bumpTilesRev(map);
  return touched;
}

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
 *
 * `opts` may be a thunk: it is invoked ONLY when an advance actually applies, so a live caller
 * can defer the expensive residents/climate gather past the years-gate (it fires every tick but
 * applies twice a year).
 */
export function advanceRoadEvolution(
  graph: RoadGraph, now: number, opts: EvolveOptions | (() => EvolveOptions) = {},
): number {
  const baseline = graph.evolvedAtTick ?? now;
  const dtYears = (now - baseline) / TICKS_PER_YEAR;
  if (graph.evolvedAtTick === undefined) { graph.evolvedAtTick = now; return 0; } // first sight: start fresh
  if (dtYears < ROAD_EVOLUTION_MIN_APPLY_YEARS) return 0;
  evolveRoadGraph(graph, dtYears, typeof opts === 'function' ? opts() : opts);
  graph.evolvedAtTick = now;
  return dtYears;
}
