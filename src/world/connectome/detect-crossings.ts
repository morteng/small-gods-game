// src/world/connectome/detect-crossings.ts
//
// Crossing DETECTION — the "where" half of the river-crossing producer. The road graph
// already records, per edge, the cells its walker chose to bridge over water
// (`edge.bridgeCells`); a maximal contiguous run of those along a road's polyline IS a
// crossing. This turns each run into a `CrossingSpec` for `buildCrossing`, pulling the
// site parameters (era / prosperity / style / biome) from a caller-supplied resolver so
// this stays decoupled from how the world models settlements & climate.
//
// Pure: reads the (immutable) road graph + a resolver callback. Changes NO rendering — the
// crossings it finds are a parallel connectome layer; flipping the road ribbon to stop at
// the banks (and realizing the spans) are later, separate steps. Until then R3b's plank
// deck stays the interim visual.

import type { RoadGraph, RoadClass } from '@/world/road-graph';
import { smoothCenterline, type Pt } from '@/terrain/road-centerline';
import type { CrossingSpec } from './crossing-builder';

/** Site parameters at a tile — supplied by the caller (nearest settlement, world climate). */
export interface CrossingSiteParams {
  era: string;
  prosperity: string;
  style?: string;
  biome?: string;
}

export interface DetectOptions {
  /** Resolve site params at a tile (defaults applied when absent). */
  siteParamsAt?: (x: number, y: number) => CrossingSiteParams;
  /** Fallback site params when no resolver is given. */
  defaults?: CrossingSiteParams;
  /** Is a tile open water? When supplied, a bank ANCHOR that lands on water is snapped
   *  OUTWARD (away from the crossing) to the first dry cell, so the realized deck seats
   *  its abutments on land rather than in the channel (the `bridge.seating` unseated-end
   *  class WP-A detects). A dry bank is left exactly where it was (byte-identical), so
   *  only genuinely wet anchors move — the conservative fix. Absent ⇒ legacy behaviour. */
  isWater?: (x: number, y: number) => boolean;
  /** Is a tile part of the VISIBLE water channel the crossing must span? When supplied, each
   *  raster crossing run is EXTENDED along the road to absorb contiguous render-wet cells, so the
   *  deck covers the full drawn ribbon (the walker bridges the thin raster line; the widened /
   *  meandered ribbon spills a tile or two past it, leaving the old deck to span dry ground beside
   *  the water). The run STILL seeds from `edge.bridgeCells` — so tangential contact between a
   *  bankside road and the wide ribbon does NOT invent a spurious crossing; only where the walker
   *  chose to bridge does one appear, now grown to the visible width. Banks then flank the extended
   *  run, landing on render-dry ground by construction. Absent ⇒ legacy (byte-identical). */
  bridgeAt?: (x: number, y: number) => boolean;
}

const DEFAULT_SITE: CrossingSiteParams = { era: 'early-medieval', prosperity: 'modest' };

/** How far (tiles) to walk a wet bank anchor outward before giving up and leaving it in
 *  place. A bank is normally 0–1 tiles off the water edge; a river wider than the detector's
 *  bridge run resumes dry land within a couple of tiles, so a small reach suffices. */
const BANK_SNAP_MAX_TILES = 4;

/** How far (polyline steps ≈ tiles) a raster crossing run may EXTEND over contiguous render-wet
 *  road cells to cover the drawn ribbon. Bounds the growth to a river's WIDTH — the widest reach
 *  half-width is ~2.2 tiles (a ~5-tile band), so a few steps past the walker's thin bridged cell
 *  reaches dry ground; a larger cap would let a bankside road grow one crossing down the shore. */
const MAX_RUN_EXTEND = 5;

/** Arc-length sampling step (tiles) when walking the smoothed ribbon to find its banks — fine
 *  enough that no 1-tile cell of the channel is stepped over. */
const RIBBON_STEP_TILES = 0.25;
/** How far (tiles) past the raster run's own extent the ribbon is scanned for the visible
 *  channel. The ribbon corner-cuts off the raw path by well under a tile, and the render ribbon
 *  spills at most ~2 tiles past the walker's thin bridged line — a small pad finds the channel
 *  without wandering downstream into a second crossing. */
const RIBBON_SCAN_PAD_TILES = 3;
/** Cap (tiles) on the outward walk from the wet run to dry ground, mirroring BANK_SNAP_MAX_TILES. */
const RIBBON_BANK_MAX_TILES = 6;

// ── The smoothed ribbon: the road the player actually SEES ───────────────────────────────
// The road graph stores the walker's RAW cell polyline, but every ribbon the game draws (and the
// terrain it carves) is `smoothCenterline(polyline)` — a centripetal Catmull-Rom through the RDP
// corners. Siting a deck from the raw polyline therefore puts it wherever the STAIRCASE ran, and
// at a bend the smoothed ribbon's corner-cut slides sideways off it — the deck sits beside the
// road, and the road paints across open water. So the banks are found ON the ribbon: THE shared
// opening (`bankCells`) is where the drawn road last touches dry ground either side of the drawn
// channel, and the deck axis is the ribbon's own secant across it.

/** Cumulative arc-length of a polyline. */
function cumulative(pts: ReadonlyArray<Pt>): number[] {
  const cum = new Array<number>(pts.length);
  cum[0] = 0;
  for (let i = 1; i < pts.length; i++) cum[i] = cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return cum;
}

/** The point at arc-length `s` along `pts` (clamped to the ends). */
function pointAtArc(pts: ReadonlyArray<Pt>, cum: number[], s: number): Pt {
  const n = pts.length;
  if (s <= 0) return pts[0];
  if (s >= cum[n - 1]) return pts[n - 1];
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= s) lo = mid; else hi = mid;
  }
  const span = cum[hi] - cum[lo] || 1;
  const w = (s - cum[lo]) / span;
  return { x: pts[lo].x + (pts[hi].x - pts[lo].x) * w, y: pts[lo].y + (pts[hi].y - pts[lo].y) * w };
}

/** Arc-length of the point on `pts` nearest (px,py). */
function arcOfNearest(pts: ReadonlyArray<Pt>, cum: number[], px: number, py: number): number {
  let best = Infinity, bestS = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = pts[i].x, ay = pts[i].y;
    const dx = pts[i + 1].x - ax, dy = pts[i + 1].y - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
    if (d < best) { best = d; bestS = cum[i] + t * Math.sqrt(len2); }
  }
  return bestS;
}

/** The two bank points where the SMOOTHED ribbon leaves the visible channel, flanking the wet run
 *  the raster crossing [sArc..eArc] sits in. Returns undefined when the ribbon never actually
 *  touches render water near this crossing (then the caller keeps the legacy raw-polyline banks —
 *  nothing to re-seat against). Pure; one scan, one rounding at the caller. */
function banksOnRibbon(
  sm: ReadonlyArray<Pt>, cum: number[], sArc: number, eArc: number,
  wet: (x: number, y: number) => boolean,
): { a: Pt; b: Pt } | undefined {
  const total = cum[cum.length - 1];
  const lo = Math.max(0, Math.min(sArc, eArc) - RIBBON_SCAN_PAD_TILES);
  const hi = Math.min(total, Math.max(sArc, eArc) + RIBBON_SCAN_PAD_TILES);
  // The ribbon's WET sub-interval near this crossing — the channel it must be carried over.
  let wetLo = Infinity, wetHi = -Infinity;
  for (let s = lo; s <= hi; s += RIBBON_STEP_TILES) {
    const p = pointAtArc(sm, cum, s);
    if (!wet(Math.round(p.x), Math.round(p.y))) continue;
    if (s < wetLo) wetLo = s;
    if (s > wetHi) wetHi = s;
  }
  if (!Number.isFinite(wetLo)) return undefined;    // ribbon misses the visible channel entirely
  // Walk OUT of the channel each way to the first dry step — the bank: the last cell of the drawn
  // road that stands on dry land. DECLINES (undefined) rather than returning a wet point when no
  // dry ground is reachable within the cap or before the ribbon ends: a road that runs into an
  // estuary, or a crossing at the very end of a road, has no ribbon-seated bank to offer, and
  // inventing one would seat an abutment in open water — exactly the defect this WP removes. The
  // caller then keeps the legacy raw-polyline banks, which is no worse than before.
  const walk = (from: number, dir: -1 | 1): Pt | undefined => {
    for (let d = RIBBON_STEP_TILES; d <= RIBBON_BANK_MAX_TILES; d += RIBBON_STEP_TILES) {
      const s = from + dir * d;
      if (s < 0 || s > total) return undefined;    // ran off the ribbon still wet
      const p = pointAtArc(sm, cum, s);
      if (!wet(Math.round(p.x), Math.round(p.y))) return p;
    }
    return undefined;                              // never cleared the water within the cap
  };
  const a = walk(wetLo, -1);
  const b = walk(wetHi, 1);
  return a && b ? { a, b } : undefined;
}

/** Push a bank anchor that sits on water outward (along `awayDir`, unit-ish) until it clears
 *  the water, so the deck end seats on dry land. No-op when the anchor is already dry. */
function snapBankToLand(
  bank: { x: number; y: number },
  awayDir: { x: number; y: number },
  isWater: (x: number, y: number) => boolean,
): { x: number; y: number } {
  const len = Math.hypot(awayDir.x, awayDir.y) || 1;
  const ux = awayDir.x / len, uy = awayDir.y / len;
  for (let s = 0; s <= BANK_SNAP_MAX_TILES; s++) {
    const cx = Math.round(bank.x + ux * s), cy = Math.round(bank.y + uy * s);
    if (!isWater(cx, cy)) return { x: cx, y: cy };
  }
  return bank;
}

/**
 * Detect every road×water crossing in the graph as a `CrossingSpec`. One spec per maximal
 * contiguous run of bridge cells along a road edge's polyline; `spanTiles` is the run
 * length, `roadClass` the edge's class, `banks` the approach points flanking the run, and
 * the site params come from the resolver evaluated at the run's midpoint.
 */
export function detectCrossings(graph: RoadGraph | undefined, width: number, opts: DetectOptions = {}): CrossingSpec[] {
  if (!graph?.edges.length) return [];
  const resolve = opts.siteParamsAt ?? (() => opts.defaults ?? DEFAULT_SITE);
  const out: CrossingSpec[] = [];

  for (const edge of graph.edges) {
    if (edge.feature !== 'road' || !edge.bridgeCells.length || edge.polyline.length < 2) continue;
    const bridge = new Set(edge.bridgeCells);
    const pts = edge.polyline;
    // The ribbon the player SEES (and the terrain carve follows) — the same smoothing
    // `edgeRoadProfile` applies. Banks are seated on THIS, not on the walker's staircase.
    const sm = opts.bridgeAt ? smoothCenterline(pts as Pt[]) : null;
    const smCum = sm && sm.length >= 2 ? cumulative(sm) : null;
    const cellOf = (p: { x: number; y: number }) => Math.floor(p.y) * width + Math.floor(p.x);
    // The run SEEDS from the walker's raster bridge cells (crossing intent + count), then extends
    // over contiguous render-wet road cells so the deck spans the full visible ribbon.
    const onBridge = pts.map((p) => bridge.has(cellOf(p)));
    const onRender = opts.bridgeAt ? pts.map((p) => opts.bridgeAt!(Math.floor(p.x), Math.floor(p.y))) : null;

    let i = 0, run = 0;
    while (i < pts.length) {
      if (!onBridge[i]) { i++; continue; }
      let s = i;
      while (i < pts.length && onBridge[i]) i++;
      let e = i - 1;                                     // raster run = polyline points [s..e]
      if (onRender) {
        // Grow the run along the road to the edge of the drawn ribbon so the deck covers it, and
        // both banks (just past the extended run) land on render-dry ground. BOUNDED to the width
        // of a river (a few tiles) — without the cap a road that hugs a wide riverbank sits in the
        // render ribbon for a long stretch, growing one monstrous crossing spanning dozens of tiles.
        let ext = 0;
        while (s > 0 && onRender[s - 1] && ext < MAX_RUN_EXTEND) { s--; ext++; }
        ext = 0;
        while (e < pts.length - 1 && onRender[e + 1] && ext < MAX_RUN_EXTEND) { e++; ext++; }
        i = Math.max(i, e + 1);                          // don't re-scan cells the extension consumed
      }
      const mid = pts[(s + e) >> 1];
      const site = resolve(Math.floor(mid.x), Math.floor(mid.y));
      let near = { x: pts[Math.max(0, s - 1)].x, y: pts[Math.max(0, s - 1)].y };
      let far = { x: pts[Math.min(pts.length - 1, e + 1)].x, y: pts[Math.min(pts.length - 1, e + 1)].y };
      let spanTiles = e - s + 1;
      let axis: [number, number] | undefined;
      let bankCells: [[number, number], [number, number]] | undefined;

      // THE SHARED OPENING. Re-seat the banks onto the SMOOTHED ribbon (the drawn road), flanking
      // the visible channel: the deck then sits ON the road instead of beside it, and its axis IS
      // the road's own direction across the water rather than the chord of two independently-
      // snapped raster points (which a bend rotated into a diagonal). ONE rounding, here, shared
      // by the deck, the ribbon pin (`pinBankOpenings`), the raster and the lint.
      const ribbon = sm && smCum
        ? banksOnRibbon(sm, smCum, arcOfNearest(sm, smCum, pts[s].x, pts[s].y),
          arcOfNearest(sm, smCum, pts[e].x, pts[e].y), opts.bridgeAt!)
        : undefined;
      if (ribbon) {
        const ca: [number, number] = [Math.round(ribbon.a.x), Math.round(ribbon.a.y)];
        const cb: [number, number] = [Math.round(ribbon.b.x), Math.round(ribbon.b.y)];
        const ax = cb[0] - ca[0], ay = cb[1] - ca[1];
        const len = Math.hypot(ax, ay);
        if (len >= 0.5) {
          near = { x: ca[0], y: ca[1] };
          far = { x: cb[0], y: cb[1] };
          bankCells = [ca, cb];
          // The threaded road tangent across the crossing — the ribbon's secant between its own
          // two bank points (pre-rounding, so the yaw doesn't inherit the cells' half-tile jitter).
          const rx = ribbon.b.x - ribbon.a.x, ry = ribbon.b.y - ribbon.a.y;
          const rl = Math.hypot(rx, ry) || 1;
          axis = [rx / rl, ry / rl];
          spanTiles = Math.max(1, Math.round(len));
        }
      }
      // Legacy / no render-water signal: seat both abutments on land by snapping each raw bank
      // outward from the crossing midpoint (the pre-ribbon behaviour, byte-identical).
      if (!bankCells && opts.isWater) {
        near = snapBankToLand(near, { x: near.x - mid.x, y: near.y - mid.y }, opts.isWater);
        far = snapBankToLand(far, { x: far.x - mid.x, y: far.y - mid.y }, opts.isWater);
      }
      out.push({
        id: `crossing@${edge.id}#${run}`,
        waterRef: `water@${cellOf(mid)}`,
        spanTiles,
        roadClass: (edge.class ?? 'road') as RoadClass,
        era: site.era,
        prosperity: site.prosperity,
        style: site.style,
        biome: site.biome,
        banks: [{ x: near.x, y: near.y }, { x: far.x, y: far.y }],
        ...(bankCells ? { bankCells } : {}),
        ...(axis ? { axis } : {}),
      });
      run++;
    }
  }
  return out;
}
