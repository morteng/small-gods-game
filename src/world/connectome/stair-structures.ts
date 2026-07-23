// src/world/connectome/stair-structures.ts
//
// G3b — STAIRS pop out of the connectome, ANCHOR-DRIVEN. Where a road's walked line climbs
// steeper than its class grade envelope (road-state.ts `GradeEnvelope`), the terrain is too
// steep for that road to roll comfortably — the envelope comment's named "reconciliation
// structure (embankment, stairs, a switchback)". This module realizes the STAIRS half in two
// separated stages, so placement is a graph match rather than a blind local heuristic:
//
//   1. DETECTION (`collectStairPorts`) scans each road edge's polyline for over-grade RUNS and
//      emits a typed `stair_anchor` port PAIR (foot + head) per run. A run earns ports ONLY when
//      (a) BOTH endpoint tiles are confirmed road, and (b) the run's NET endpoint-to-endpoint
//      gradient on a SMOOTHED profile (not per-rounded-segment local grade) exceeds the class
//      grade — so a noise bump mid-slope no longer fires a stair connected to nothing, while the
//      emergent "stairs where the road climbs" behavior is preserved (the generator decides WHERE
//      ports exist). The ports flow through `anchor-collect` and are paired by `matchAnchors`.
//   2. PLACEMENT (`placeStairsFromLinks`) instantiates a flight strictly BETWEEN each matched
//      foot/head pair, driving `sampleSpanSegments` so EACH stacked segment lifts to its OWN
//      terrain height — killing the single-`liftElev` floating-head artifact of the old one-entity
//      -per-run scheme.
//
// `buildStairStructureEntities` composes both stages (detection → match → placement) for the
// synthetic harness + unit tests; the live world (map-generator) runs detection into the GLOBAL
// anchor set and placement off `map.anchorLinks`. Pure + deterministic throughout (seeded
// blueprints, deterministic matcher); `Math.random`-free.

import type { Entity } from '@/core/types';
import type { RoadGraph, RoadClass } from '@/world/road-graph';
import type { Anchor } from '@/world/anchors';
import { matchAnchors, type AnchorLink } from '@/world/anchor-rules';
import { ensureBuildingTypesRegistered } from '@/blueprint/register-buildings';
import { blueprintEntity } from '@/blueprint/entity';
import { resolveBlueprint } from '@/blueprint/resolve';
import { stairFootprint, stairTreads } from '@/blueprint/parts/stair';
import { BLUEPRINT_VERSION, type Blueprint } from '@/blueprint/types';
import { METRES_PER_TILE } from '@/render/scale-contract';
import { type SpanSegment, type SpanPoint, sampleSpanSegments, densifyToUnitSteps, cardinalOf } from './road-span';

/** Stair construction + material + running width AND the ACTUAL surface grade (rise/run) above
 *  which that class wants steps instead of a rolled surface. Deliberately distinct from the
 *  road-router's `GradeEnvelope.maxGrade` (now metre-true too — 8/12/18/25 % by class): the
 *  envelope is the SOFT routing-cost knee the walker economises around, while these are the
 *  hard walkability grades past which a rolled surface stops working — set one class-step
 *  steeper, so a flight only appears where the router genuinely could not buy its way down
 *  to grade. A cart highway wants steps past ~12 %; a footpath scrambles to ~33 %. A footpath
 *  gets a rough timber scramble; a highway a broad dressed-stone flight. */
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
/** A SINGLE flight tops out around here: ~4 tiles (8 m) of ground run at 45° lifts ~8 m, a tall
 *  civic stair. Past it the chunk is not a walkable flight but a cliff/retaining wall — and, left
 *  uncapped, exactly what produced the 10-to-20-tile-tall MONUMENT on a deeply-incised riverbank
 *  (a crossing whose bridge failed to seat, so the road still ran down the raw bank). A run that
 *  needs more than this is SKIPPED, not staired (a genuinely long WALKABLE climb still stairs — it
 *  arrives as several ≤`MAX_FLIGHT_RUN_TILES` chunks, each under the cap, STACKED up the slope). */
const MAX_STAIR_RISE_M = 8;
/** A detected run (one port PAIR) spans at most this much ground run — the snap rule's `maxGap`
 *  is sized to it. A long steep climb chunks into consecutive capped runs (stacked port pairs),
 *  each riding its own terrain, with implied landings between (G3c). */
const MAX_FLIGHT_RUN_TILES = 4;
/** Placement sub-stacks each matched foot→head pair into pieces at most this long, so EACH piece
 *  seats on its own terrain (the engine has one scalar `liftElev` per entity, so a longer single
 *  flight floats its head). Finer than `MAX_FLIGHT_RUN_TILES` on purpose. */
const STAIR_STACK_SEG_TILES = 2;
const MIN_TREADS = 3;
/** Two runs from DIFFERENT roads whose feet are closer than this (Chebyshev tiles) read as a
 *  pile-up, not two staircases — parallel roads climbing the same riverbank near a crossing each
 *  spawned a flight, jamming a knot of steps into a few tiles. The first-detected (deterministic
 *  graph order) wins; a later road's run within the radius emits NO ports (so no orphan). Runs on
 *  the SAME road are exempt — a continuous climb is one staircase. */
const MIN_CROSS_EDGE_SPACING = 3;
/** Half-window (tiles along the path) of the elevation smoother that kills single-tile noise
 *  bumps before the net-gradient test reads the run endpoints. */
const SMOOTH_HALF = 1;

/** Cardinal (or 'diag') classification of a unit step a→b. */
function stepKind(a: SpanPoint, b: SpanPoint): 'north' | 'south' | 'east' | 'west' | 'diag' {
  const dx = b.x - a.x, dy = b.y - a.y;
  if (dx !== 0 && dy !== 0) return 'diag';
  return cardinalOf(dx, dy);
}

/** Unit vector a→b, or [0,0] if degenerate. */
function unit(ax: number, ay: number, bx: number, by: number): [number, number] {
  const dx = bx - ax, dy = by - ay;
  const m = Math.hypot(dx, dy);
  return m === 0 ? [0, 0] : [dx / m, dy / m];
}

export interface StairPortOptions {
  /** Normalised [0,1] heightfield elevation at a tile — the SAME space the grade envelope's
   *  `maxGrade` is measured in (per-step `|Δelev| / horiz`). Required. */
  elevAt: (x: number, y: number) => number;
  /** Metres of relief per normalised elevation unit (`worldStyle.mountainRelief`). */
  reliefM: number;
  /** A cell confirmed to carry a road (a `dirt_road`/`stone_road` tile in the live mask). A port
   *  emits ONLY where BOTH its endpoints are confirmed road — the false-positive killer for a
   *  polyline point that rounds off the stamped road. Omitted ⇒ every densified polyline cell of
   *  the edge counts as road (synthetic harness / unit tests with no tile mask). */
  isRoadTile?: (x: number, y: number) => boolean;
  /** A cell a stair may NOT foot/head on (water, an existing building, a wall curtain). */
  cellBlocked?: (x: number, y: number) => boolean;
  /** True when a cell sits within the exclusion radius of a river CROSSING bank. A stair whose
   *  foot or head lands here is suppressed: the steep drop there is the river's incised bank, where
   *  a BRIDGE belongs — not a flight. This is the locus of the orphaned-monument bug (a crossing
   *  whose deck failed to seat left the road running down the raw bank, which then over-graded into
   *  a giant standalone stair with no bridge beside it). Omitted ⇒ no crossing awareness (tests). */
  nearCrossing?: (x: number, y: number) => boolean;
}

/**
 * Scan every ROAD edge for over-grade runs and emit a `stair_anchor` port pair (foot + head) per
 * qualifying run. Detection is pure terrain × class — stairs emerge wherever the connectome routes
 * a road up too steep a cardinal run — but a run earns ports ONLY when both endpoints are confirmed
 * road AND its NET smoothed endpoint-to-endpoint gradient beats the class grade, so a noise bump no
 * longer fabricates a disconnected flight. Deterministic given the same graph + fields.
 */
export function collectStairPorts(graph: RoadGraph | undefined, opts: StairPortOptions): Anchor[] {
  if (!graph) return [];
  const out: Anchor[] = [];
  const usedTiles = new Set<string>();
  // Feet already claimed, with their owning edge — a later road's run too close to an EARLIER
  // road's foot is a pile-up and emits no ports (same-road stacked runs are exempt).
  const placedFeet: { x: number; y: number; edge: string }[] = [];
  const tooCrowded = (fx: number, fy: number, edgeId: string): boolean =>
    placedFeet.some((p) => p.edge !== edgeId && Math.max(Math.abs(p.x - fx), Math.abs(p.y - fy)) < MIN_CROSS_EDGE_SPACING);

  for (const edge of graph.edges) {
    if (edge.feature !== 'road') continue;
    const poly = edge.polyline;
    if (poly.length < MIN_RUN_TILES + 1) continue;
    const classGrade = CLASS_STAIR[edge.class].grade;

    // Densify to the unit-step lattice (the SAME lattice placement stacks on), then build the raw
    // + smoothed elevation profile the net-gradient test reads.
    const verts: SpanPoint[] = [];
    for (const p of poly) {
      const q = { x: Math.round(p.x), y: Math.round(p.y) };
      const last = verts[verts.length - 1];
      if (!last || last.x !== q.x || last.y !== q.y) verts.push(q);
    }
    if (verts.length < 2) continue;
    const pts = densifyToUnitSteps(verts);
    const raw = pts.map((p) => opts.elevAt(p.x, p.y));
    // MEDIAN smoother (window ±SMOOTH_HALF, out-of-range indices substituted by the centre sample).
    // A median REJECTS a single-tile noise spike (the false-positive source) while preserving a
    // linear ramp EXACTLY — including at the path ends, where a mean would bias the endpoint inward
    // and under-measure a legitimately steep terminal run.
    const smooth = raw.map((_, i) => {
      const win: number[] = [];
      for (let k = i - SMOOTH_HALF; k <= i + SMOOTH_HALF; k++) win.push(raw[k] ?? raw[i]);
      win.sort((a, b) => a - b);
      return win[(win.length - 1) >> 1];
    });
    // Default on-road predicate: membership in THIS edge's densified cells (endpoints are on the
    // edge by construction, so the check is a no-op absent a real tile mask). The live world hands
    // in `isRoadTile` reading the stamped mask, which rejects a point that drifted off the road.
    const edgeCells = new Set(pts.map((p) => `${p.x},${p.y}`));
    const onRoad = (p: SpanPoint): boolean =>
      opts.isRoadTile ? opts.isRoadTile(p.x, p.y) : edgeCells.has(`${p.x},${p.y}`);

    // Chunk into maximal same-cardinal runs capped at MAX_FLIGHT_RUN_TILES; a diagonal step never
    // bears a run (its head can't land on the road, so no floating stair).
    let i = 0, chunkIdx = 0;
    while (i < pts.length - 1) {
      const kind = stepKind(pts[i], pts[i + 1]);
      if (kind === 'diag') { i += 1; continue; }
      let j = i;
      while (j + 1 < pts.length && j - i < MAX_FLIGHT_RUN_TILES && stepKind(pts[j], pts[j + 1]) === kind) j++;
      const runTiles = j - i;
      // Orient foot (lower) → head (higher) on the SMOOTHED profile; net gradient reads endpoints.
      const [footI, headI] = smooth[i] <= smooth[j] ? [i, j] : [j, i];
      const foot = pts[footI], head = pts[headI];
      const riseM = (smooth[headI] - smooth[footI]) * opts.reliefM;
      const grade = runTiles > 0 ? riseM / (runTiles * METRES_PER_TILE) : 0;
      const footKey = `${foot.x},${foot.y}`;
      // A flight foots+heads on confirmed road, and NO cell along its span is blocked — a stair
      // must not span water (that stretch is a crossing) or a building; the placement sub-stacking
      // would otherwise seat an intermediate piece on the obstacle.
      let spanClear = true;
      for (let k = i; k <= j && spanClear; k++) if (opts.cellBlocked?.(pts[k].x, pts[k].y)) spanClear = false;
      if (
        runTiles >= MIN_RUN_TILES && riseM >= MIN_RISE_M && riseM <= MAX_STAIR_RISE_M
        && grade > classGrade && onRoad(foot) && onRoad(head) && spanClear
        && !(opts.nearCrossing?.(foot.x, foot.y) || opts.nearCrossing?.(head.x, head.y))
        && !usedTiles.has(footKey) && !tooCrowded(foot.x, foot.y, edge.id)
      ) {
        usedTiles.add(footKey);
        placedFeet.push({ x: foot.x, y: foot.y, edge: edge.id });
        const pairKey = `${edge.id}:stair:${chunkIdx}`;
        const fFace = unit(foot.x, foot.y, head.x, head.y);   // foot looks uphill toward the head
        out.push({ kind: 'stair_anchor', x: foot.x, y: foot.y, facing: fFace, width: runTiles,
          ownerId: edge.id, id: `${pairKey}:foot`, pair: pairKey, tags: ['grade'] });
        out.push({ kind: 'stair_anchor', x: head.x, y: head.y, facing: [-fFace[0], -fFace[1]], width: runTiles,
          ownerId: edge.id, id: `${pairKey}:head`, pair: pairKey, tags: ['grade'] });
      }
      chunkIdx += 1;
      i = j;
    }
  }
  return out;
}

function stairEntity(
  id: string,
  cls: RoadClass,
  seg: SpanSegment,
  liftElev: number | undefined,
  ports: [string, string],
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
  const props = e.properties as Record<string, unknown>;
  if (liftElev !== undefined) props.liftElev = liftElev;
  // The lint (`stair.connected`) reads these: the flight's foot/head tiles must be road-adjacent,
  // and every emitted port must be consumed by exactly one flight structure.
  props.stairFoot = { x: seg.from.x, y: seg.from.y };
  props.stairHead = { x: seg.to.x, y: seg.to.y };
  props.stairPorts = ports;
  return e;
}

export interface StairPlacementOptions {
  /** Normalised [0,1] heightfield elevation at a tile — orients + sizes each stacked piece. */
  elevAt: (x: number, y: number) => number;
  /** Metres of relief per normalised elevation unit (`worldStyle.mountainRelief`). */
  reliefM: number;
  /** Render-space (curved) elevation at a tile, to seat each stacked piece's foot on the terrain
   *  the way decks ride their banks (G4 liftElev). Omitted ⇒ the piece foot-samples (sinks). */
  liftElevAt?: (x: number, y: number) => number;
}

/**
 * Instantiate stair flights from the matched `stair_anchor`↔`stair_anchor` links. Each link's two
 * ports bound one over-grade run; the run is cardinal-colinear, so the between-path is a straight
 * foot→head line that `sampleSpanSegments` stacks into `STAIR_STACK_SEG_TILES` pieces, EACH seated
 * on its own terrain. Deterministic: links are ordered foot-first up each edge's climb.
 */
export function placeStairsFromLinks(
  links: ReadonlyArray<AnchorLink>,
  graph: RoadGraph | undefined,
  opts: StairPlacementOptions,
): Entity[] {
  ensureBuildingTypesRegistered();   // inline stair_flight blueprint resolves directly
  const classOf = new Map<string, RoadClass>((graph?.edges ?? []).map((e) => [e.id, e.class]));
  // Gather stair links oriented foot→head, then sort into a stable per-edge climb order so the
  // emitted entity sequence is deterministic (and the lowest foot of each edge comes first).
  const runs = links
    .filter((l) => l.a.kind === 'stair_anchor' && l.b.kind === 'stair_anchor')
    .map((l) => {
      const ea = opts.elevAt(l.a.x, l.a.y), eb = opts.elevAt(l.b.x, l.b.y);
      const [foot, head] = ea <= eb ? [l.a, l.b] : [l.b, l.a];
      const edge = foot.ownerId ?? head.ownerId ?? '';
      return { edge, foot, head, footElev: Math.min(ea, eb), ports: [foot.id ?? '', head.id ?? ''] as [string, string] };
    })
    .sort((p, q) => p.edge.localeCompare(q.edge) || p.footElev - q.footElev || p.foot.x - q.foot.x || p.foot.y - q.foot.y);

  const out: Entity[] = [];
  // ONE flight per (edge, foot cell). An edge's polyline visits a cell at most once on a
  // simple climb, so a foot uniquely names a flight — but a route that revisits a cell
  // (e.g. a detour bending back around a lake margin) can seed TWO over-grade runs from
  // the same foot, which would stack two stairs on that one tile AND collide their
  // foot-keyed ids (`re2:stair:33_20:0`). The deterministic sort above already orders
  // runs foot-first up each edge; keep the first at each foot, drop the rest.
  const seenFoot = new Set<string>();
  for (const run of runs) {
    const footKey = `${run.edge}:${run.foot.x}_${run.foot.y}`;
    if (seenFoot.has(footKey)) continue;
    seenFoot.add(footKey);
    const cls = classOf.get(run.edge) ?? 'path';
    const subpath: SpanPoint[] = [{ x: run.foot.x, y: run.foot.y }, { x: run.head.x, y: run.head.y }];
    const segs = sampleSpanSegments(subpath, { elevAt: opts.elevAt, reliefM: opts.reliefM, maxSegTiles: STAIR_STACK_SEG_TILES });
    segs.forEach((seg, k) => {
      const liftElev = opts.liftElevAt?.(seg.from.x, seg.from.y);
      out.push(stairEntity(`${run.edge}:stair:${run.foot.x}_${run.foot.y}:${k}`, cls, seg, liftElev, run.ports));
    });
  }
  return out;
}

export interface StairStructureOptions extends StairPortOptions, StairPlacementOptions {}

/**
 * Detect stair ports, match them, and place the flights — the full anchor-driven pipeline in
 * miniature. Used by the synthetic harness + unit tests; the live world routes the same two stages
 * through the GLOBAL anchor set (see map-generator). Pure + deterministic.
 */
export function buildStairStructureEntities(
  graph: RoadGraph | undefined,
  opts: StairStructureOptions,
): Entity[] {
  const ports = collectStairPorts(graph, opts);
  const links = matchAnchors(ports, {});   // the stair↔stair rule lives in DEFAULT_RULES
  return placeStairsFromLinks(links, graph, opts);
}
