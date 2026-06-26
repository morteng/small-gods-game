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
 *  route a road 30 tiles up a 50% slope) must NOT become one 40 m staircase shooting off into
 *  the air — it gets ONE believable flight at the steepest pitch; switchbacks / stacked flights
 *  for the full climb are future work (G3c). */
const MAX_FLIGHT_RUN_TILES = 4;
const MIN_TREADS = 3;

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

/** Quantize a run vector to the cardinal climb the `stair_flight` part understands, pointing
 *  toward the HIGHER end (steps rise that way). */
function climbDir(dx: number, dy: number): 'north' | 'south' | 'east' | 'west' {
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'east' : 'west';
  return dy >= 0 ? 'south' : 'north';
}

function stairEntity(
  id: string,
  cls: RoadClass,
  foot: { x: number; y: number },
  dir: 'north' | 'south' | 'east' | 'west',
  riseM: number,
  runTilesGround: number,
  liftElev: number | undefined,
): Entity {
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
 * Site a stair flight on every over-grade run of every ROAD edge in the graph. Detection is
 * pure terrain × class (the grade envelope), so stairs emerge wherever the connectome routes a
 * road up a slope steeper than its class tolerates — "all kinds of stairs, popping out of the
 * connectome", exactly as bridges pop out of crossings.
 */
export function buildStairStructureEntities(
  graph: RoadGraph | undefined,
  opts: StairStructureOptions,
): Entity[] {
  if (!graph) return [];
  ensureBuildingTypesRegistered();   // inline stair_flight blueprint resolves directly
  const out: Entity[] = [];
  const usedTiles = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.feature !== 'road') continue;
    const poly = edge.polyline;
    if (poly.length < MIN_RUN_TILES + 1) continue;
    // The class's ACTUAL walkability grade (rise/run) above which it wants steps.
    const classGrade = CLASS_STAIR[edge.class].grade;

    // Slide a ~MAX_FLIGHT_RUN_TILES window along the line and place a flight wherever the road
    // GAINS elevation steeply ON AVERAGE over the window. (A successfully-routed road climbs in
    // a zigzag — one steep step, one flat — so consecutive over-grade STEPS are mostly length-1;
    // the steep STRETCH is what wants stairs, measured as net rise over the window's run, not a
    // monotonic step chain.) On a hit, place the flight and jump past it; else step forward.
    let i = 0;
    while (i < poly.length - 1) {
      // Grow the window from i until its arc length reaches the single-flight span (or the end).
      let j = i, arc = 0;
      while (j + 1 < poly.length && arc < MAX_FLIGHT_RUN_TILES) {
        arc += Math.hypot(poly[j + 1].x - poly[j].x, poly[j + 1].y - poly[j].y);
        j++;
      }
      const a = poly[i], b = poly[j];
      const runTiles = Math.hypot(b.x - a.x, b.y - a.y);
      const riseM = Math.abs(opts.elevAt(b.x, b.y) - opts.elevAt(a.x, a.y)) * opts.reliefM;
      const actualGrade = runTiles > 0 ? riseM / (runTiles * METRES_PER_TILE) : 0;
      if (runTiles >= MIN_RUN_TILES && riseM >= MIN_RISE_M && actualGrade > classGrade) {
        // Foot = the LOWER end (the flight climbs up toward the higher end).
        const aHigher = opts.elevAt(a.x, a.y) >= opts.elevAt(b.x, b.y);
        const foot = aHigher ? b : a;
        const head = aHigher ? a : b;
        const fx = Math.round(foot.x), fy = Math.round(foot.y);
        const key = `${fx},${fy}`;
        if (!usedTiles.has(key) && !opts.cellBlocked?.(fx, fy)) {
          usedTiles.add(key);
          const dir = climbDir(head.x - foot.x, head.y - foot.y);
          const liftElev = opts.liftElevAt?.(fx, fy);
          out.push(stairEntity(`${edge.id}:stair:${i}`, edge.class, { x: fx, y: fy }, dir, riseM, runTiles, liftElev));
        }
        i = j;   // jump past the placed flight so a long climb doesn't stack overlapping stairs
        continue;
      }
      i++;
    }
  }
  return out;
}
