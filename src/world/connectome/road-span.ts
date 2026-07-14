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
 * Walk a polyline sub-path and chunk it into consecutive {@link SpanSegment}s that FOLLOW THE PATH,
 * cover its whole length, AND ARE EACH CARDINAL-COLINEAR — every piece's `from`→`to` lies along one
 * cardinal axis, so a cardinal-oriented structure placed on it (the engine has no per-entity
 * rotation) lands its far end EXACTLY on the road's continuation. This is the connection guarantee
 * the start/stop vocabulary exists for: a stair flight foots at `from` and its head reaches `to`, a
 * real road tile, instead of a diagonal chord's head floating off into space.
 *
 * The path is first densified to unit steps, then chunked into maximal **same-cardinal runs**
 * (broken by a direction change OR `maxSegTiles`): a long straight climb becomes stacked same-
 * cardinal pieces (implied landings between), an L-bend gets one piece per cardinal leg, and a
 * genuinely DIAGONAL stretch (45°, all diagonal unit steps) shatters into single-tile pieces — the
 * caller's minimum-run filter then drops them, so a diagonal road gets NO floating stair rather than
 * a disconnected one. Each segment is oriented foot(low)→head(high) by the elevation sampler. Pure +
 * deterministic; `[]` for a path shorter than two distinct tiles.
 */
export function sampleSpanSegments(path: SpanPoint[], opts: SampleSpanOptions): SpanSegment[] {
  const maxSeg = Math.max(1, Math.floor(opts.maxSegTiles ?? 4));
  // Round to the integer tile lattice, drop consecutive duplicates, then DENSIFY to unit steps so
  // every consecutive pair differs by one tile (cardinal or diagonal) — that makes "same-cardinal
  // run" a simple unit-step classification and keeps each run provably colinear.
  const verts: SpanPoint[] = [];
  for (const p of path) {
    const q = { x: Math.round(p.x), y: Math.round(p.y) };
    const last = verts[verts.length - 1];
    if (!last || last.x !== q.x || last.y !== q.y) verts.push(q);
  }
  if (verts.length < 2) return [];
  const pts = densifyToUnitSteps(verts);

  // The unit step a→b is "pure cardinal" iff exactly one of dx/dy is non-zero.
  const stepKind = (a: SpanPoint, b: SpanPoint): 'north' | 'south' | 'east' | 'west' | 'diag' => {
    const dx = b.x - a.x, dy = b.y - a.y;
    if (dx !== 0 && dy !== 0) return 'diag';
    return cardinalOf(dx, dy);
  };

  const out: SpanSegment[] = [];
  let i = 0;
  while (i < pts.length - 1) {
    const kind = stepKind(pts[i], pts[i + 1]);
    if (kind === 'diag') { out.push(makeSegment(pts[i], pts[i + 1], opts)); i += 1; continue; }
    // Grow a maximal same-cardinal run, capped at maxSeg tiles. All steps share one cardinal, so
    // pts[i]→pts[j] is a straight cardinal line — `to` is exactly `from + run·cardinal`.
    let j = i;
    while (j + 1 < pts.length && j - i < maxSeg && stepKind(pts[j], pts[j + 1]) === kind) j++;
    out.push(makeSegment(pts[i], pts[j], opts));
    i = j;
  }
  return out;
}

/** Densify a deduped integer vertex list so every consecutive pair differs by a single tile, using
 *  a greedy 8-connected line walk (diagonal where both axes move, cardinal otherwise). A path that
 *  is already unit-stepped passes through unchanged. Exported for the stair-port grade scan, which
 *  walks the SAME densified lattice to keep its runs colinear with the placement stacking. */
export function densifyToUnitSteps(verts: SpanPoint[]): SpanPoint[] {
  const out: SpanPoint[] = [verts[0]];
  for (let k = 1; k < verts.length; k++) {
    let { x, y } = out[out.length - 1];
    const b = verts[k];
    while (x !== b.x || y !== b.y) {
      x += Math.sign(b.x - x);
      y += Math.sign(b.y - y);
      out.push({ x, y });
    }
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
