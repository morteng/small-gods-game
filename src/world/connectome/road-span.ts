// src/world/connectome/road-span.ts
//
// The SHARED START/STOP VOCABULARY for road-anchored span structures.
//
// All geometry pops out of the connectome — just in different ways. Stairs and bridges turn
// out to be the SAME kind of thing: a structure sited on a stretch of a road edge that the road
// can't simply roll across, whose two ends both anchor back to the road. The road STOPS at one
// end, the structure carries the traveller across the obstacle, and the road RESUMES at the
// other end:
//
//   • a STAIR flight  — obstacle 'grade': the ground climbs steeper than the road class can
//                       roll, so the run is replaced by stepped treads. start = foot (lower),
//                       end = head (higher).
//   • a BRIDGE deck   — obstacle 'water': a gap the road can't ford, so a deck spans it on piers
//                       /abutments. start = bank0, end = bank1.
//
// Both detectors used to reinvent this start/stop bookkeeping privately (a local `climbDir` in
// the stair siter, a local north-south axis calc in the deck builder). This module is the one
// place that names a `RoadSpan` and answers the questions every span structure asks of it:
// which way does it run, how long is it, and which end seats onto which bank. Pure, no deps.

import type { RoadClass } from '@/world/road-graph';

/** Why the road can't simply continue across this stretch — selects the structure family. */
export type SpanObstacle = 'grade' | 'water';

/** A tile coordinate (integer cell). */
export interface SpanPoint {
  x: number;
  y: number;
}

/**
 * A stretch of a road edge that an obstacle interrupts and a span structure crosses. Both ends
 * anchor back to the road: the road stops at {@link start}, the structure spans to {@link end},
 * the road resumes. `start`→`end` is the travel direction the structure is oriented along (for a
 * stair, uphill; for a bridge, the chosen bank order). Pure data — the structure builders read
 * it to size + orient + seat their geometry.
 */
export interface RoadSpan {
  /** The road edge this span sits on (`RoadEdge.id`). */
  edgeId: string;
  /** Road class — drives styling (a footpath scramble vs a dressed-stone highway flight/deck). */
  cls: RoadClass;
  /** Where the structure begins / the road stops. */
  start: SpanPoint;
  /** Where the structure ends / the road resumes. */
  end: SpanPoint;
  /** What the road can't roll across here. */
  obstacle: SpanObstacle;
}

// — Vector-level quantizers (the shared primitives; both a `RoadSpan` and a bare direction
//   vector — e.g. a crossing deck's `Placement.dir` — funnel their orientation through these,
//   so a stair flight and a bridge deck answer "which way does it run" identically). —

/** The dominant axis a run vector lies along — what a `deck`/`stair` parapet orientation wants. */
export function axisOf(dx: number, dy: number): 'ns' | 'ew' {
  return Math.abs(dy) >= Math.abs(dx) ? 'ns' : 'ew';
}

/** Quantize a run vector to the cardinal it points along. Ties on the diagonal resolve to the
 *  horizontal (matches the pre-unification stair `climbDir`). */
export function cardinalOf(dx: number, dy: number): 'north' | 'south' | 'east' | 'west' {
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'east' : 'west';
  return dy >= 0 ? 'south' : 'north';
}

/** Run vector start→end, in tiles. */
export function spanVector(span: RoadSpan): { dx: number; dy: number } {
  return { dx: span.end.x - span.start.x, dy: span.end.y - span.start.y };
}

/** Straight-line length of the span, in tiles. */
export function spanLengthTiles(span: RoadSpan): number {
  const { dx, dy } = spanVector(span);
  return Math.hypot(dx, dy);
}

/** The dominant axis the span runs along — what `deck`/parapet orientation wants. */
export function spanAxis(span: RoadSpan): 'ns' | 'ew' {
  const { dx, dy } = spanVector(span);
  return axisOf(dx, dy);
}

/** The cardinal direction of TRAVEL start→end — what the `stair_flight` part's `dir` wants
 *  (steps rise toward `end`). */
export function spanCardinal(span: RoadSpan): 'north' | 'south' | 'east' | 'west' {
  const { dx, dy } = spanVector(span);
  return cardinalOf(dx, dy);
}

/** Order a span's two endpoints so `start` is the LOWER end and `end` the higher, given an
 *  elevation sampler. The canonical orientation for a climbing structure (a stair foots low and
 *  rises; a bridge deck rides the higher bank). Returns a new span; never mutates. */
export function orientUphill(span: RoadSpan, elevAt: (x: number, y: number) => number): RoadSpan {
  const eStart = elevAt(span.start.x, span.start.y);
  const eEnd = elevAt(span.end.x, span.end.y);
  if (eStart <= eEnd) return span;
  return { ...span, start: span.end, end: span.start };
}

// — Path-follow core (the shared spline-follow primitive) —
//
// The engine has NO per-entity rotation and `liftElev` is a single scalar per entity, so a
// structure that follows a curved road AND rides varying terrain must be realized as a SEQUENCE
// of short cardinal-oriented pieces, each lifted to its own ground. This is the one place that
// turns a polyline sub-path into those pieces: a stair siter makes one flight per segment, a
// bridge siter one deck-bay (+ pier) per segment — both "follow the spline" identically.

/** A short, single-cardinal piece of a span's polyline path. The structure builders instance one
 *  element per segment (a stair flight, a deck bay), oriented along {@link dir} and lifted to the
 *  terrain at {@link from}. After {@link sampleSpanSegments}, `from` is always the LOWER end. */
export interface SpanSegment {
  /** Lower (placement/foot) end of the segment, integer tile. */
  from: SpanPoint;
  /** Higher end, integer tile (the piece runs from→to). */
  to: SpanPoint;
  /** Cardinal bearing from→to — the piece's own orientation. */
  dir: 'north' | 'south' | 'east' | 'west';
  /** Dominant axis from→to. */
  axis: 'ns' | 'ew';
  /** Straight-line length of the segment, in tiles. */
  runTiles: number;
  /** Normalised elevation sampled at `from` / `to`. */
  fromElev: number;
  toElev: number;
  /** Metric rise across the segment (`|toElev − fromElev| · reliefM`). */
  riseM: number;
}

export interface SampleSpanOptions {
  /** Normalised [0,1] heightfield elevation at a tile. */
  elevAt: (x: number, y: number) => number;
  /** Metres of relief per normalised elevation unit (`worldStyle.mountainRelief`). */
  reliefM: number;
  /** A single piece spans at most this much arc length; a longer stretch is split into stacked
   *  pieces (stairs ⇒ stacked flights with implied landings; bridges ⇒ regular deck bays).
   *  Defaults to 4 tiles. */
  maxSegTiles?: number;
}

/**
 * Walk a polyline sub-path and chunk it into consecutive arc-length {@link SpanSegment}s that
 * FOLLOW THE PATH and cover its whole length. Each window grows until its arc reaches
 * `maxSegTiles` (or the path ends), then its NET endpoints decide the piece's cardinal + rise — so
 * a zigzag-diagonal road (alternating 1-tile E/S steps) reads as its dominant diagonal cardinal
 * rather than shattering into sub-tile pieces, a long straight climb becomes stacked same-cardinal
 * pieces (implied landings between), and a road that turns gets a piece per leg. Each segment is
 * oriented foot(low)→head(high) by the elevation sampler. Pure + deterministic; `[]` for a path
 * shorter than two distinct tiles.
 */
export function sampleSpanSegments(path: SpanPoint[], opts: SampleSpanOptions): SpanSegment[] {
  const maxSeg = opts.maxSegTiles ?? 4;
  // Round to the integer tile lattice and drop consecutive duplicates — placement + cardinal are
  // tile-quantized anyway, and a deduped vertex list makes the windowing clean.
  const pts: SpanPoint[] = [];
  for (const p of path) {
    const q = { x: Math.round(p.x), y: Math.round(p.y) };
    const last = pts[pts.length - 1];
    if (!last || last.x !== q.x || last.y !== q.y) pts.push(q);
  }
  if (pts.length < 2) return [];

  const out: SpanSegment[] = [];
  let i = 0;
  while (i < pts.length - 1) {
    // Grow the window from i until its arc length reaches the single-piece span (or the end).
    let j = i, arc = 0;
    while (j + 1 < pts.length && arc < maxSeg) {
      arc += Math.hypot(pts[j + 1].x - pts[j].x, pts[j + 1].y - pts[j].y);
      j++;
    }
    out.push(makeSegment(pts[i], pts[j], opts));   // NET endpoints of the window
    i = j;
  }
  return out;
}

/** Build one oriented segment foot(low)→head(high) from two tile endpoints. */
function makeSegment(a: SpanPoint, b: SpanPoint, opts: SampleSpanOptions): SpanSegment {
  const ea = opts.elevAt(a.x, a.y);
  const eb = opts.elevAt(b.x, b.y);
  const [from, to, fromElev, toElev] = ea <= eb ? [a, b, ea, eb] : [b, a, eb, ea];
  const dx = to.x - from.x, dy = to.y - from.y;
  return {
    from, to,
    dir: cardinalOf(dx, dy),
    axis: axisOf(dx, dy),
    runTiles: Math.hypot(dx, dy),
    fromElev, toElev,
    riseM: (toElev - fromElev) * opts.reliefM,
  };
}
