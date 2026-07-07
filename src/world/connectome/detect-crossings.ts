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
      // Seat both abutments on land: the polyline point just past the bridge run can still
      // fall on water when the channel is wider than the run the detector captured (the deck
      // then floats one cell short of the true bank). Snap each wet anchor outward from the
      // crossing midpoint to dry ground so the realized deck spans bank-to-bank.
      if (opts.isWater) {
        near = snapBankToLand(near, { x: near.x - mid.x, y: near.y - mid.y }, opts.isWater);
        far = snapBankToLand(far, { x: far.x - mid.x, y: far.y - mid.y }, opts.isWater);
      }
      out.push({
        id: `crossing@${edge.id}#${run}`,
        waterRef: `water@${cellOf(mid)}`,
        spanTiles: e - s + 1,
        roadClass: (edge.class ?? 'road') as RoadClass,
        era: site.era,
        prosperity: site.prosperity,
        style: site.style,
        biome: site.biome,
        banks: [{ x: near.x, y: near.y }, { x: far.x, y: far.y }],
      });
      run++;
    }
  }
  return out;
}
