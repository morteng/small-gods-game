// src/world/connectome/aqueduct-profile.ts
//
// G6 — the AQUEDUCT as the inverted river. A river is hydrology's OUTPUT (water the terrain
// sheds, carved downhill by gravity); an aqueduct is an INPUT — water carried from a high source
// to a settlement along a near-constant, AUTHOR-CHOSEN gentle down-grade, regardless of terrain.
// Where the ground rises above that water line the channel is CUT through it; where the ground
// falls away below it the channel rides a deck/arches ELEVATED over the gap; where the ground
// descends gently within the grade band the channel hugs the SURFACE. Those three modes are not
// three rules — they fall out of ONE: the water surface only ever falls (never climbs) and never
// falls faster than the class envelope allows.
//
// This module is the pure, path-independent CORE of that: given an already-chosen source→sink
// tile path and an elevation sampler, it lays the gravity water-line and classifies every tile.
// It owns no routing (where the path goes — `aqueduct-route.ts`, later) and no placement (what
// makes an aqueduct appear — a worldgen decision, later); it answers only "given THIS line, what
// must the channel do to carry water down it, and is that even feasible?". Pure + deterministic
// (no RNG, no I/O); reuses the shared cardinal-run vocabulary so its segments orient like a
// stair flight or a bridge deck bay.

import { METRES_PER_TILE } from '@/render/scale-contract';
import { axisOf, cardinalOf, type SpanPoint } from './road-span';

/** How an aqueduct meets the ground at one station along its line. */
export type AqueductMode =
  | 'cut'       // ground rises above the held water-line → trench/tunnel through it
  | 'surface'   // ground sits within the channel depth of the water-line → a graded channel on grade
  | 'elevated'; // ground falls away below the water-line → carry it on a deck / arches

/** The channel's state at one tile along its path (the water-line is in absolute metres, the same
 *  space as `elevAt · reliefM`). */
export interface AqueductStation {
  /** Tile (integer cell). */
  x: number;
  y: number;
  /** Natural ground height here, in metres. */
  terrainM: number;
  /** Authored channel water-surface height here, in metres (monotone non-increasing source→sink). */
  waterM: number;
  /** How the channel meets the ground. */
  mode: AqueductMode;
  /** `waterM − terrainM`: negative ⇒ the line runs below ground (cut depth = −clearM); positive ⇒
   *  it runs above ground (deck height = clearM); ~0 ⇒ on the surface. */
  clearM: number;
}

/** A maximal run of consecutive same-mode, same-cardinal stations — what the renderer instances as
 *  one element (a cut channel reach, a surface channel reach, or a row of deck bays), oriented along
 *  {@link dir} the way a stair flight / deck bay is. `from`→`to` is the travel direction (source→sink). */
export interface AqueductSegment {
  from: SpanPoint;
  to: SpanPoint;
  /** Cardinal bearing from→to. */
  dir: 'north' | 'south' | 'east' | 'west';
  /** Dominant axis from→to. */
  axis: 'ns' | 'ew';
  /** How this whole run meets the ground. */
  mode: AqueductMode;
  /** Straight-line length of the run, in tiles. */
  runTiles: number;
  /** Water-surface height (metres) at `from` / `to`. */
  fromWaterM: number;
  toWaterM: number;
}

export interface AqueductProfile {
  /** Per-tile channel state, source first → sink last. */
  stations: AqueductStation[];
  /** Same data grouped into render-ready (mode, cardinal) runs. */
  segments: AqueductSegment[];
  /** Total drop in the water-line from source to sink, in metres (≥ 0). */
  totalFallM: number;
  /** Head the water arrives with at the sink: `waterM(sink) − terrainM(sink)`, in metres. ≥ 0 means
   *  the water reaches the settlement at or above ground (usable); < 0 means it arrives below ground
   *  (would need a terminal cut / pressurised section). */
  deliveredHeadM: number;
  /** Deepest cut along the line (≥ 0). */
  maxCutM: number;
  /** Tallest elevated section along the line (≥ 0). */
  maxElevatedM: number;
  /** True when the line can actually carry water: source above sink, no cut beyond the cap, head
   *  delivered within tolerance. When false, {@link reason} names why (and the router must try
   *  another line / the placement is rejected). */
  feasible: boolean;
  reason?: string;
}

export interface AqueductProfileOptions {
  /** Normalised [0,1] ground elevation at a tile (the same field stairs/roads sample). Required. */
  elevAt: (x: number, y: number) => number;
  /** Metres of relief per normalised elevation unit (`worldStyle.mountainRelief`). Required. */
  reliefM: number;
  /** Maximum water-surface FALL as a grade (rise/run): the steepest gentle descent the channel
   *  holds. Roman practice ≈ 0.003 (0.3%); default 0.004. The channel never falls faster than this,
   *  so a steep drop in the ground becomes an elevated span rather than a waterfall. */
  maxGrade?: number;
  /** Minimum water-surface FALL as a grade — the channel must keep descending at least this much so
   *  the water always flows (no flat/ponding). Default 0.0005 (0.05%). */
  minGrade?: number;
  /** Channel water depth, metres — within this distance of the water-line the ground reads as
   *  `surface` rather than `cut`/`elevated`. Default 0.6 m. */
  channelDepthM?: number;
  /** A cut deeper than this (metres) is infeasible here — a hill too tall to trench, which the
   *  router should have gone around. Default 8 m. */
  cutDepthMaxM?: number;
  /** The water may arrive at the sink at most this far below ground (metres) and still count as
   *  delivered (a short terminal cut into the settlement is fine). Default 1 m. */
  sinkUndershootM?: number;
}

/**
 * Lay the gravity water-line along a source→sink tile path and classify every tile as cut / surface
 * / elevated. The path's FIRST point is the source (intake), its LAST the sink (delivery).
 *
 * The water-line is a greedy monotone forward pass: it starts at the source ground and at each step
 * tries to HUG the terrain, but clamped into the per-step grade band so it can neither rise nor fall
 * faster than the envelope. From that one constraint the three modes emerge — a gentle descent keeps
 * the line on the ground (`surface`); a rise leaves the line below ground (`cut`); a steep drop
 * outruns the line, leaving the ground below it (`elevated`).
 *
 * Returns `null` only for a degenerate path (< 2 distinct tiles). An UNROUTABLE-but-well-formed line
 * returns a profile with `feasible:false` and a `reason` (so the router/placer can inspect the
 * structural cost before discarding it). Pure + deterministic.
 */
export function planAqueductProfile(
  path: SpanPoint[],
  opts: AqueductProfileOptions,
): AqueductProfile | null {
  const maxGrade = opts.maxGrade ?? 0.004;
  const minGrade = Math.min(opts.minGrade ?? 0.0005, maxGrade);
  const channelDepthM = opts.channelDepthM ?? 0.6;
  const cutDepthMaxM = opts.cutDepthMaxM ?? 8;
  const sinkUndershootM = opts.sinkUndershootM ?? 1;
  const reliefM = opts.reliefM;

  // Round to the tile lattice and drop consecutive duplicates; the path is assumed already
  // tile-adjacent (the router emits unit steps), so no densify pass is needed here.
  const pts: SpanPoint[] = [];
  for (const p of path) {
    const q = { x: Math.round(p.x), y: Math.round(p.y) };
    const last = pts[pts.length - 1];
    if (!last || last.x !== q.x || last.y !== q.y) pts.push(q);
  }
  if (pts.length < 2) return null;

  const terrainM = (p: SpanPoint) => opts.elevAt(p.x, p.y) * reliefM;

  const stations: AqueductStation[] = [];
  let waterPrev = terrainM(pts[0]);          // the intake sits at the source ground
  let maxCutM = 0;
  let maxElevatedM = 0;

  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const ground = terrainM(p);
    let water: number;
    if (i === 0) {
      water = waterPrev;
    } else {
      const stepLenM = Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y) * METRES_PER_TILE;
      const upper = waterPrev - minGrade * stepLenM;  // must drop ≥ minGrade ⇒ at or below this
      const lower = waterPrev - maxGrade * stepLenM;  // may drop ≤ maxGrade ⇒ at or above this
      // Hug the ground where the band allows; otherwise ride the nearer band edge.
      water = Math.min(upper, Math.max(lower, ground));
    }
    waterPrev = water;

    const clearM = water - ground;
    let mode: AqueductMode;
    if (clearM < -channelDepthM) {
      mode = 'cut';
      if (-clearM > maxCutM) maxCutM = -clearM;
    } else if (clearM > channelDepthM) {
      mode = 'elevated';
      if (clearM > maxElevatedM) maxElevatedM = clearM;
    } else {
      mode = 'surface';
    }
    stations.push({ x: p.x, y: p.y, terrainM: ground, waterM: water, mode, clearM });
  }

  const source = stations[0];
  const sink = stations[stations.length - 1];
  const totalFallM = source.waterM - sink.waterM;
  const deliveredHeadM = sink.waterM - sink.terrainM;

  let feasible = true;
  let reason: string | undefined;
  if (source.terrainM <= sink.terrainM) {
    feasible = false;
    reason = 'source not above sink — gravity flow impossible';
  } else if (maxCutM > cutDepthMaxM) {
    feasible = false;
    reason = `cut ${maxCutM.toFixed(1)}m exceeds cap ${cutDepthMaxM}m — route around the rise`;
  } else if (deliveredHeadM < -sinkUndershootM) {
    feasible = false;
    reason = `water arrives ${(-deliveredHeadM).toFixed(1)}m below the sink — line too long for the fall`;
  }

  return {
    stations,
    segments: groupSegments(stations),
    totalFallM,
    deliveredHeadM,
    maxCutM,
    maxElevatedM,
    feasible,
    reason,
  };
}

const stepDir = (a: AqueductStation, b: AqueductStation) => cardinalOf(b.x - a.x, b.y - a.y);

/** Group stations into render-ready runs. A tile has exactly one mode, so runs PARTITION the
 *  stations (they never share a tile): first into maximal same-mode runs, then each of those into
 *  cardinal-colinear pieces (a bend within one mode splits the run). The renderer instances one
 *  element per piece — "this 5-tile east run is elevated (a row of deck bays)", "this 3-tile north
 *  run is cut (a trench reach)" — each a straight cardinal piece (the engine has no per-entity
 *  rotation, exactly as stairs/decks require). A cut reach and the elevated reach beside it simply
 *  meet at their shared boundary edge. Every station is covered by exactly one piece. */
function groupSegments(stations: AqueductStation[]): AqueductSegment[] {
  const out: AqueductSegment[] = [];
  if (stations.length < 2) return out;
  let i = 0;
  while (i < stations.length) {
    let j = i;
    while (j + 1 < stations.length && stations[j + 1].mode === stations[i].mode) j++;
    splitCardinal(out, stations, i, j);   // stations[i..j] share a mode
    i = j + 1;
  }
  return out;
}

/** Split a same-mode station run [i0..i1] into maximal same-cardinal pieces. */
function splitCardinal(out: AqueductSegment[], stations: AqueductStation[], i0: number, i1: number): void {
  if (i1 <= i0) {
    // A single-tile mode island (e.g. a lone cut tile between surface reaches): emit it as a
    // zero-length piece so coverage stays complete; orient it by an adjacent step.
    const ref = i0 + 1 < stations.length ? i0 + 1 : i0 - 1;
    const dir = ref >= 0 ? stepDir(stations[Math.min(i0, ref)], stations[Math.max(i0, ref)]) : 'east';
    pushRun(out, stations, i0, i0, dir);
    return;
  }
  let segStart = i0;
  let curDir = stepDir(stations[i0], stations[i0 + 1]);
  for (let k = i0 + 1; k < i1; k++) {
    const d = stepDir(stations[k], stations[k + 1]);
    if (d !== curDir) {
      pushRun(out, stations, segStart, k, curDir);
      segStart = k;
      curDir = d;
    }
  }
  pushRun(out, stations, segStart, i1, curDir);
}

function pushRun(
  out: AqueductSegment[],
  stations: AqueductStation[],
  i0: number,
  i1: number,
  dir: 'north' | 'south' | 'east' | 'west',
): void {
  if (i1 < i0) return;
  const a = stations[i0];
  const b = stations[i1];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  out.push({
    from: { x: a.x, y: a.y },
    to: { x: b.x, y: b.y },
    dir,
    axis: axisOf(dx, dy),
    mode: a.mode,
    runTiles: Math.hypot(dx, dy),
    fromWaterM: a.waterM,
    toWaterM: b.waterM,
  });
}
