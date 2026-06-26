// src/world/road-state.ts
//
// The road PARAMETER MODEL (design doc 2026-06-24 "Road as a connectome projection").
//
// A road's carve/surface is NOT keyed on its `RoadClass` — class is one input among
// many. `RoadState` is the derived, time-varying bundle that the carve (road-deformation)
// and the surface channel both consume. It is a PURE function of connectome signals
// (endpoint prosperity/importance, era/tech, traffic, surface) plus optional time-varying
// dynamics (age/upkeep/wear/overgrowth) injected by the road-system tick.
//
// The headline knob is `construction` (engineered earth-moving effort): a footpath
// (low) FOLLOWS the terrain, a prosperous cobbled highway (high) CUTS a flat graded
// shelf THROUGH the hill — "they spent more on workers modifying terrain." It drives the
// longitudinal grade-smoothing window in the carve, so the cut-through emerges from one
// parameter.
//
// Pure + deterministic. No Math.random, no sim mutation.

import type { RoadClass, RoadSurface } from '@/world/road-graph';
import { ERAS, type Era } from '@/core/era';
import { clamp01 } from '@/core/math';

export type SurfaceMaterial = 'dirt' | 'gravel' | 'cobble' | 'paved';

/** The derived, (eventually) time-varying state of one road edge. */
export interface RoadState {
  /** Engineered earth-moving effort 0..1 — THE knob: follow terrain (0) → cut through (1). */
  construction: number;
  /** Wearing surface — drives the material channel, curb crispness, gutter depth. */
  surfaceMaterial: SurfaceMaterial;
  /** Carriageway half-width in tiles. */
  carriageHalfWidth: number;
  /** Use intensity 0..1 (connectome flow proxy). Suppresses overgrowth, deepens ruts. */
  traffic: number;
  /** Upkeep 0..1 — 1 = freshly built / well maintained, 0 = abandoned ruin. */
  condition: number;
  /** Years since built / last major rebuild. */
  ageYears: number;
  /** Cumulative wear 0..1 (age × traffic × disrepair) — rut depth, edge softening. */
  wear: number;
  /** Reclamation by vegetation 0..1 — surface shifts to green, carve softens. */
  overgrowth: number;
}

/** Time-varying dynamics injected by the road-system tick; absent = a new, kept road. */
export type RoadDynamics = Partial<Pick<RoadState, 'ageYears' | 'condition' | 'traffic' | 'wear' | 'overgrowth'>>;

export interface RoadStateInput {
  roadClass: RoadClass;
  surface: RoadSurface;
  era: Era;
  /** Significance 0..3 of the busier endpoint; defaults from class when omitted. */
  endpointRank?: number;
  dynamic?: RoadDynamics;
}

/** Class → a 0..3 significance rank (the same ladder road-graph uses to assign class). */
const CLASS_RANK: Record<RoadClass, number> = { path: 0, track: 1, road: 2, highway: 3 };

/** Class → carriageway half-width in tiles (a tile is 2 m). Sized to real medieval
 *  running surfaces: footpath ≈ 1.4 m, packhorse track ≈ 2 m, cart road ≈ 3.2 m,
 *  major road ≈ 4.4 m — narrower than the earlier values, which read as motorways. */
const CLASS_HALF_WIDTH: Record<RoadClass, number> = { path: 0.35, track: 0.5, road: 0.8, highway: 1.1 };

/** Era → a 0..1 technology factor (primordial 0 … current 1) — engineering capability. */
export function eraTech(era: Era): number {
  const i = ERAS.indexOf(era);
  return i < 0 ? 0.75 : i / (ERAS.length - 1);
}

// ── Per-class GRADE ENVELOPE (G1: grade reconciliation) ───────────────────────────
// How steep a class of road tolerates being. Units are the road-walker's per-step
// grade `g = |Δelev| / horiz` in NORMALISED elevation (the [0,1] heightfield), the same
// unit as the walker's old global `DEFAULT_MAX_GRADE = 0.05`. Above `maxGrade` the
// router's over-grade penalty bites, so the walk prefers a longer gentle detour /
// switchback — and where the terrain leaves no gentle line, the route comes out OVER the
// envelope, which is the signal that a reconciliation structure (embankment, stairs, a
// bridge) is wanted there. `road` is held at the prior global default so the commonest
// class is unchanged; a highway wants a near-flat grade and switchbacks hard, a footpath
// takes a steep line a cart never could.
export interface GradeEnvelope {
  /** Per-step grade (normalised elev/tile) above which the over-grade penalty applies. */
  maxGrade: number;
  /** Penalty multiplier on grade ABOVE `maxGrade` — higher = avoids steepness harder. */
  overGradePenalty: number;
}

const GRADE_ENVELOPE: Record<RoadClass, GradeEnvelope> = {
  highway: { maxGrade: 0.035, overGradePenalty: 700 },
  road: { maxGrade: 0.05, overGradePenalty: 450 },
  track: { maxGrade: 0.07, overGradePenalty: 300 },
  path: { maxGrade: 0.11, overGradePenalty: 180 },
};

/** The steepness a road class tolerates — drives the router's switchback/structure choice. */
export function gradeEnvelope(roadClass: RoadClass): GradeEnvelope {
  return GRADE_ENVELOPE[roadClass];
}

/**
 * Derive a road's state from connectome signals. `construction` blends endpoint
 * significance (they could afford the labour), era tech (they had the engineering),
 * and surface (a stone road implies investment). `dynamic` lets the road-system tick
 * override the time-varying fields; without it a road is new (condition 1, no wear).
 */
export function deriveRoadState(input: RoadStateInput): RoadState {
  const { roadClass, surface, era } = input;
  const rank = input.endpointRank ?? CLASS_RANK[roadClass];
  const importance = clamp01(rank / 3);
  const tech = eraTech(era);
  const surfaceStone = surface === 'stone' ? 1 : 0;

  // Engineered effort: mostly who it serves, then the era's capability, then the
  // evidence of spend (a paved surface). Footpath-dirt-medieval ≈ 0.19; a
  // stone highway in the current era ≈ 1.0.
  const construction = clamp01(0.5 * importance + 0.25 * tech + 0.25 * surfaceStone);

  // Surface material: stone → cobble, upgrading to paved at high spend; dirt →
  // gravel once it is a real road, else a bare dirt track.
  const surfaceMaterial: SurfaceMaterial =
    surface === 'stone'
      ? construction > 0.8
        ? 'paved'
        : 'cobble'
      : construction > 0.6
        ? 'gravel'
        : 'dirt';

  const carriageHalfWidth = CLASS_HALF_WIDTH[roadClass] * (0.85 + 0.3 * construction);

  const dyn = input.dynamic ?? {};
  // Traffic proxy until the connectome carries real flow: busier endpoints → more use.
  const traffic = clamp01(dyn.traffic ?? 0.3 + 0.6 * importance);
  const condition = clamp01(dyn.condition ?? 1);
  const ageYears = Math.max(0, dyn.ageYears ?? 0);
  // Wear accrues from use on a road that isn't kept up; a new road (condition 1) is unworn.
  const wear = clamp01(dyn.wear ?? clamp01(traffic * (1 - condition)));
  const overgrowth = clamp01(dyn.overgrowth ?? 0);

  return { construction, surfaceMaterial, carriageHalfWidth, traffic, condition, ageYears, wear, overgrowth };
}

// ── Cross-section parameters: RoadState → the carve's metric shape ────────────────
// All metres unless noted. The carve (road-deformation) reads these; centralising the
// param model here keeps it pure + unit-testable and shared with the surface channel.

export interface RoadCrossSection {
  carriageHalf: number;          // tiles — half the running surface
  cutStrength: number;           // 0..1 — how strongly the bed levels to grade (level peak)
  gradeWindowTiles: number;      // longitudinal grade-smoothing window — THE cut-through knob
  crownM: number;                // centre camber above the carriageway edge
  hasCurb: boolean;
  curbWidthTiles: number;
  curbHeightM: number;           // raised kerb lip (creates the gutter that pools water)
  gutterDepthM: number;          // dip just inside the curb
  ditchDepthM: number;           // side drainage ditch beyond the shoulder (0 = none)
  ditchOffsetTiles: number;      // centre-distance to the ditch
  shoulderFeatherTiles: number;  // taper back to untouched terrain
  rutDepthM: number;             // worn wheel ruts
  edgeNoiseM: number;            // surface/edge irregularity (wear + overgrowth)
}

/** Map a RoadState to its metric cross-section. Monotonic in the obvious directions. */
export function roadCrossSection(s: RoadState): RoadCrossSection {
  const c = s.construction;
  const hasCurb = (s.surfaceMaterial === 'cobble' || s.surfaceMaterial === 'paved') && c > 0.6;
  const curbWidthTiles = 0.3;
  return {
    carriageHalf: s.carriageHalfWidth,
    // A footpath barely pulls to grade (follows the slope); a highway levels a full shelf.
    cutStrength: clamp01(0.2 + 0.7 * c),
    // The cut-through lever: low construction → ~2-tile window (tracks local ground);
    // high → ~16-tile window (flattens a long grade, cutting hills + filling dips).
    gradeWindowTiles: 1 + 15 * Math.pow(c, 1.5),
    crownM: (0.035 + 0.07 * c) * s.condition,
    hasCurb,
    curbWidthTiles,
    curbHeightM: hasCurb ? 0.12 * s.condition : 0,
    gutterDepthM: hasCurb ? 0.1 * c : 0,
    // Engineered roads cut drainage ditches; paths don't.
    ditchDepthM: c > 0.5 ? 0.12 * c * s.condition : 0,
    ditchOffsetTiles: s.carriageHalfWidth + curbWidthTiles + 0.5,
    // Worn / overgrown edges blur back into the land. Kept tight so a minor road
    // reads as a trail, not a wide muddy scar; wear/overgrowth still broaden it.
    shoulderFeatherTiles: 0.5 + 0.6 * s.wear + 0.5 * s.overgrowth,
    rutDepthM: 0.09 * s.wear * (0.5 + 0.5 * s.traffic),
    edgeNoiseM: 0.05 * s.wear + 0.06 * s.overgrowth,
  };
}
