// src/world/connectome/stair-structures.ts
//
// G3b — STAIRS pop out of the connectome. Where a road's walked line exceeds its class
// grade envelope (road-state.ts `GradeEnvelope`), the terrain is too steep for that road to
// climb comfortably — exactly the signal the envelope comment names as wanting "a
// reconciliation structure (embankment, stairs, a switchback)". This module realizes the
// STAIRS half: it scans each road edge's polyline for over-grade runs and sites a parametric
// `stair_flight` entity on each, climbing toward the higher end, sized by the run's rise and
// finished by road class (a footpath gets a rough scramble, a highway a dressed flight) —
// the same construction sweep `deriveRoadState` uses for road surfaces.
//
// Pure + deterministic (returns `Entity[]`, inline blueprints seed identically); the caller
// adds them at world-build time, beside the river crossings, before the static draw cache.

import type { Entity } from '@/core/types';
import type { RoadGraph, RoadClass } from '@/world/road-graph';
import { ensureBuildingTypesRegistered } from '@/blueprint/register-buildings';
import { blueprintEntity } from '@/blueprint/entity';
import { resolveBlueprint } from '@/blueprint/resolve';
import { stairFootprint, stairTreads } from '@/blueprint/parts/stair';
import { BLUEPRINT_VERSION, type Blueprint } from '@/blueprint/types';
import { METRES_PER_TILE } from '@/render/scale-contract';
import { type SpanSegment, sampleSpanSegments } from './road-span';

/** Stair construction + material + running width AND the ACTUAL surface grade (rise/run) above
 *  which that class wants steps instead of a rolled surface. NOTE this is the real walkability
 *  grade, NOT the road-router's `GradeEnvelope.maxGrade` — that envelope is a soft routing-cost
 *  knob set near cliff-level (≈150% grade), which a successfully-routed road never approaches,
 *  so triggering off it produced ZERO stairs in-world. A cart highway wants steps past a gentle
 *  ~12%; a footpath scrambles to ~33% before it's worth cutting steps. A footpath also gets a
 *  rough timber scramble; a highway a broad dressed-stone flight. */
const CLASS_STAIR: Record<RoadClass, { construction: number; material: string; widthM: number; grade: number }> = {
  highway: { construction: 0.85, material: 'stone', widthM: 3.5, grade: 0.12 },
  road: { construction: 0.65, material: 'stone', widthM: 2.5, grade: 0.18 },
  track: { construction: 0.4, material: 'timber', widthM: 1.8, grade: 0.25 },
  path: { construction: 0.2, material: 'timber', widthM: 1.2, grade: 0.33 },
};

/** A steep run earns a flight only when it is at least this long AND lifts at least this much —
 *  below it the road's own carve handles the grade and a flight would just be clutter. */
const MIN_RUN_TILES = 2;
const MIN_RISE_M = 1.5;        // one storey — below this it's a step, not a flight
/** A single flight spans at most this much ground run. A long steep climb (the connectome can
 *  route a road 30 tiles up a 50% slope) must NOT become one 40 m staircase shooting off into the
 *  air — it chunks into stacked ≤4-tile flights, each riding its own terrain, with implied landings
 *  between (G3c). */
const MAX_FLIGHT_RUN_TILES = 4;
const MIN_TREADS = 3;
/** Two flights from DIFFERENT roads closer than this (Chebyshev tiles) read as a pile-up, not two
 *  staircases — several roads climbing the same riverbank near a crossing each spawned their own
 *  flight, jamming a knot of steps into a few tiles. The first-placed (deterministic graph order)
 *  wins; a later road's flight within the radius is dropped (the road's own carve still climbs).
 *  Stacked flights on the SAME road are exempt — a continuous climb is one staircase. */
const MIN_CROSS_EDGE_SPACING = 3;

export interface StairStructureOptions {
  /** Normalised [0,1] heightfield elevation at a tile — the SAME space the grade envelope's
   *  `maxGrade` is measured in (per-step `|Δelev| / horiz`). Required. */
  elevAt: (x: number, y: number) => number;
  /** Metres of relief per normalised elevation unit (`worldStyle.mountainRelief`) — converts a
   *  run's normalised lift into the stair's metric rise. */
  reliefM: number;
  /** Render-space (curved) elevation at a tile, to seat the flight's foot on the terrain the
   *  way decks ride their banks (G4 liftElev). Omitted ⇒ the flight foot-samples (sinks). */
  liftElevAt?: (x: number, y: number) => number;
  /** A cell a stair may NOT occupy (water, an existing building). Over-grade runs that land on
   *  a blocked tile are skipped. */
  cellBlocked?: (x: number, y: number) => boolean;
}

function stairEntity(
  id: string,
  cls: RoadClass,
  seg: SpanSegment,
  liftElev: number | undefined,
): Entity {
  // The segment is oriented from(foot)→to(head); the flight foots at `from` and climbs the
  // segment's cardinal toward `to` (steps rise that way) — the shared path-follow vocabulary.
  const foot = seg.from;
  const dir = seg.dir;
  const riseM = seg.riseM;
  const runTilesGround = seg.runTiles;
  const { construction, material, widthM } = CLASS_STAIR[cls];
  // FIT the flight to the ground it sits on: pick the tread COUNT so the flight's run
  // (treads × runM) matches the actual horizontal run, and its riser (riseM / treads) matches
  // the actual rise. Without this the rise-derived tread count produces a run that bears no
  // relation to the slope, so the staircase shoots off into the air past the terrain it climbs.
  const runM = stairTreads({ riseM, construction }).runM;
  const groundRunM = runTilesGround * METRES_PER_TILE;
  const treads = Math.max(MIN_TREADS, Math.round(groundRunM / runM));
  const fp = stairFootprint({ riseM, treads, construction, widthM });
  const bp: Blueprint = {
    version: BLUEPRINT_VERSION, class: 'prop', preset: 'stair_flight', category: 'infrastructure',
    footprint: { w: fp.w, h: fp.h }, materials: { walls: material, roof: material, ground: 'dirt' },
    parts: { flight: { type: 'stair_flight', at: { x: 0, y: 0 }, size: { w: fp.w, h: fp.h }, params: {
      riseM, treads, widthM, construction, dir, railing: cls === 'highway' || cls === 'road' ? 'both' : 'none',
    } } },
  };
  const rb = resolveBlueprint([bp], 0);
  const e = blueprintEntity(id, rb, foot.x, foot.y);
  if (liftElev !== undefined) (e.properties as Record<string, unknown>).liftElev = liftElev;
  return e;
}

/**
 * Site stair flights along every ROAD edge in the graph that FOLLOW the road and CONNECT to it at
 * both ends. The edge polyline is chunked into cardinal-colinear segments (`sampleSpanSegments`);
 * every segment that climbs steeper than its class walkability grade gets its own `stair_flight`,
 * footed at the segment's lower end and lifted to that tile's terrain — so a long climb becomes a
 * run of stacked flights riding the slope (not one billboard into the air), an L-bend gets a flight
 * per cardinal leg, and flat stretches between steep ones stay plain road. Because each segment is
 * cardinal-colinear, a flight foots on a road tile and its head reaches the road tile where the
 * climb continues — start/end both anchor to the road. A genuinely DIAGONAL (45°) stretch shatters
 * into single-tile pieces below `MIN_RUN_TILES`, so it gets NO stair rather than a floating,
 * disconnected one (the road's own carve still climbs the grade). Detection is pure terrain × class,
 * so stairs emerge wherever the connectome routes a road up too steep a slope on a cardinal run —
 * "all kinds of stairs, popping out of the connectome", exactly as bridges pop out of crossings.
 */
export function buildStairStructureEntities(
  graph: RoadGraph | undefined,
  opts: StairStructureOptions,
): Entity[] {
  if (!graph) return [];
  ensureBuildingTypesRegistered();   // inline stair_flight blueprint resolves directly
  const out: Entity[] = [];
  const usedTiles = new Set<string>();
  // Feet already placed, with their owning edge — a later road's flight too close to an EARLIER
  // road's flight is a pile-up and gets dropped (stacked flights on the same road are exempt).
  const placedFeet: { x: number; y: number; edge: string }[] = [];
  const tooCrowded = (fx: number, fy: number, edgeId: string): boolean =>
    placedFeet.some((p) => p.edge !== edgeId && Math.max(Math.abs(p.x - fx), Math.abs(p.y - fy)) < MIN_CROSS_EDGE_SPACING);
  for (const edge of graph.edges) {
    if (edge.feature !== 'road') continue;
    const poly = edge.polyline;
    if (poly.length < MIN_RUN_TILES + 1) continue;
    // The class's ACTUAL walkability grade (rise/run) above which it wants steps.
    const classGrade = CLASS_STAIR[edge.class].grade;

    // Follow the road: one flight per over-grade segment of its polyline. Each segment is cardinal-
    // colinear (foot and head are the SAME road tiles the climb passes through), so a flight that
    // exceeds the class grade connects to the road at both ends. A diagonal/zigzag stretch yields
    // only sub-MIN_RUN pieces below, so it stays plain (carved) road — no floating stair.
    const segs = sampleSpanSegments(poly, {
      elevAt: opts.elevAt, reliefM: opts.reliefM, maxSegTiles: MAX_FLIGHT_RUN_TILES,
    });
    segs.forEach((seg, idx) => {
      const actualGrade = seg.runTiles > 0 ? seg.riseM / (seg.runTiles * METRES_PER_TILE) : 0;
      if (seg.runTiles < MIN_RUN_TILES || seg.riseM < MIN_RISE_M || actualGrade <= classGrade) return;
      const fx = seg.from.x, fy = seg.from.y;   // foot = the segment's lower end (already integer)
      const key = `${fx},${fy}`;
      if (usedTiles.has(key) || opts.cellBlocked?.(fx, fy) || tooCrowded(fx, fy, edge.id)) return;
      usedTiles.add(key);
      placedFeet.push({ x: fx, y: fy, edge: edge.id });
      const liftElev = opts.liftElevAt?.(fx, fy);
      out.push(stairEntity(`${edge.id}:stair:${idx}`, edge.class, seg, liftElev));
    });
  }
  return out;
}
