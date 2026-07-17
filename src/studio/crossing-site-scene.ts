// src/studio/crossing-site-scene.ts
//
// Pure helpers for the 🏞 Crossing Site studio (?studio=crossingsite) — the scene-
// authoring half, kept DOM-free so it unit-tests without a canvas:
//
//   · `pickCrossingSite` — scan a generated patch's water raster for the best place to
//     author a road ACROSS the stream: a reasonably narrow channel, crossed roughly
//     perpendicular, with dry approach ground on both banks. Deterministic (pure scan,
//     no RNG) so the same seed always yields the same crossing.
//   · `poisForCrossing` — the two synthetic bank endpoints + one connection, with POI
//     `importance` chosen so `buildRoadGraph`'s own `classForConnection` derives exactly
//     the road class the studio dial asks for (no forked class logic).
//   · `shownCrossingTier` — the tier the scene RENDERS: the earned tier when it can
//     physically span the detected channel, else the min-viable structure (labelled),
//     else "ferry" (nothing on the ladder spans it).
//
// The studio drives the REAL pipeline with these: buildRoadGraph walks+carves, then
// detectCrossings/bridge realization express the crossing — same fns worldgen runs.

import type { GameMap, POI, Connection } from '@/core/types';
import { WATER_TYPES } from '@/core/constants';
import type { RoadClass } from '@/world/road-graph';
import { tierSpans, minViableTier, type CrossingTier } from '@/world/road-use';

/** A chosen crossing site on a generated patch. */
export interface CrossingSitePick {
  /** Channel midpoint cell (a water tile). */
  site: { x: number; y: number };
  /** Crossing direction — 'ew' = the road runs west→east across a N–S-ish channel. */
  axis: 'ew' | 'ns';
  /** Water run length (tiles) along the crossing axis through `site`. */
  channelT: number;
  /** Road endpoint on the near bank (set back from the water). */
  a: { x: number; y: number };
  /** Road endpoint on the far bank. */
  b: { x: number; y: number };
}

/** Widest channel (tiles) worth crossing — beyond this the ladder can't span it anyway
 *  (CROSSING_TIER_MAX_SPAN_T tops out at 14; the raster run is usually narrower than the
 *  spanned ribbon, so keep some headroom under that). */
const MAX_CHANNEL_T = 8;
/** How far (tiles) each road endpoint sits back from its bank — a generous approach so the
 *  expressed ribbon reads as a ROAD arriving at a crossing, not a stub (still site-scale). */
const SETBACK_T = 16;
/** Extra outward steps allowed when the setback cell lands in water (a meander loop). */
const SETBACK_EXTRA_T = 6;
/** Keep endpoints this far off the patch edge (the walker needs working room). */
const EDGE_MARGIN_T = 3;

function isWaterTile(map: GameMap, x: number, y: number): boolean {
  const t = map.tiles?.[y]?.[x];
  return !!t && WATER_TYPES.has(t.type);
}

/** First land cell stepping outward from `from` along (dx,dy), starting `SETBACK_T` out,
 *  walking up to `SETBACK_EXTRA_T` further. Undefined when none in bounds/margin. */
function landEndpoint(
  map: GameMap, from: { x: number; y: number }, dx: number, dy: number,
): { x: number; y: number } | undefined {
  for (let s = SETBACK_T; s <= SETBACK_T + SETBACK_EXTRA_T; s++) {
    const x = from.x + dx * s, y = from.y + dy * s;
    if (x < EDGE_MARGIN_T || y < EDGE_MARGIN_T
      || x >= map.width - EDGE_MARGIN_T || y >= map.height - EDGE_MARGIN_T) return undefined;
    if (!isWaterTile(map, x, y)) return { x, y };
  }
  return undefined;
}

/**
 * Pick the best authored-crossing site on a generated patch: scan every maximal water run
 * along both axes, keep runs of width ≤ MAX_CHANNEL_T whose two banks both offer a dry
 * road endpoint SETBACK_T tiles out, and score narrow + central best. Pure + deterministic;
 * null when the patch offers no crossable channel (then the panel says so honestly).
 */
export function pickCrossingSite(map: GameMap): CrossingSitePick | null {
  const W = map.width, H = map.height;
  const cx = W / 2, cy = H / 2;
  let best: CrossingSitePick | null = null;
  let bestScore = Infinity;

  const consider = (pickAxis: 'ew' | 'ns', runStart: number, runEnd: number, cross: number): void => {
    const width = runEnd - runStart + 1;
    if (width < 1 || width > MAX_CHANNEL_T) return;
    const horizontal = pickAxis === 'ew';
    const mid = (runStart + runEnd) >> 1;
    const site = horizontal ? { x: mid, y: cross } : { x: cross, y: mid };
    const bankA = horizontal ? { x: runStart - 1, y: cross } : { x: cross, y: runStart - 1 };
    const bankB = horizontal ? { x: runEnd + 1, y: cross } : { x: cross, y: runEnd + 1 };
    const a = landEndpoint(map, bankA, horizontal ? -1 : 0, horizontal ? 0 : -1);
    const b = landEndpoint(map, bankB, horizontal ? 1 : 0, horizontal ? 0 : 1);
    if (!a || !b) return;
    // Prefer a REAL stream (~3 tiles) over the narrowest neck: a 1-cell head reads as a
    // ditch and the bridge stands on barely-visible water; too wide and only the top
    // tiers span it. Then prefer central (the scene's focal point).
    const score = Math.abs(width - 3) * 2 + (Math.abs(site.x - cx) + Math.abs(site.y - cy)) * 0.05;
    if (score < bestScore) {
      bestScore = score;
      best = { site, axis: pickAxis, channelT: width, a, b };
    }
  };

  // Horizontal water runs (crossed by an E–W road) — one pass per row.
  for (let y = EDGE_MARGIN_T; y < H - EDGE_MARGIN_T; y++) {
    let x = 0;
    while (x < W) {
      if (!isWaterTile(map, x, y)) { x++; continue; }
      const s = x;
      while (x < W && isWaterTile(map, x, y)) x++;
      if (s > 0 && x < W) consider('ew', s, x - 1, y);   // both banks on-patch
    }
  }
  // Vertical water runs (crossed by a N–S road) — one pass per column.
  for (let x = EDGE_MARGIN_T; x < W - EDGE_MARGIN_T; x++) {
    let y = 0;
    while (y < H) {
      if (!isWaterTile(map, x, y)) { y++; continue; }
      const s = y;
      while (y < H && isWaterTile(map, x, y)) y++;
      if (s > 0 && y < H) consider('ns', s, y - 1, x);
    }
  }
  return best;
}

/** POI `importance` per road-class dial — `classForConnection` (road-graph.ts) ranks the
 *  busier endpoint: low→path · medium→track · high→road · critical→highway. Using the
 *  walker's OWN derivation (not an override) keeps class → grade envelope → carriage
 *  width all consistent with a real world. */
export const CLASS_POI_IMPORTANCE: Record<RoadClass, NonNullable<POI['importance']>> = {
  path: 'low', track: 'medium', road: 'high', highway: 'critical',
};

/** The two synthetic bank POIs + one road connection that author the crossing edge. */
export function poisForCrossing(
  cls: RoadClass, a: { x: number; y: number }, b: { x: number; y: number },
): { pois: POI[]; connections: Connection[] } {
  const importance = CLASS_POI_IMPORTANCE[cls] ?? 'medium';
  const pois: POI[] = [
    { id: 'bank-a', type: 'hamlet', name: 'Near bank', position: { ...a }, importance },
    { id: 'bank-b', type: 'hamlet', name: 'Far bank', position: { ...b }, importance },
  ];
  const connections: Connection[] = [{ from: 'bank-a', to: 'bank-b', type: 'road' }];
  return { pois, connections };
}

/** What the scene should RENDER for an earned tier over a channel of `spanTiles`. */
export interface ShownTier {
  /** The tier actually rendered (earned, or the min-viable upgrade when earned can't span). */
  shown: CrossingTier;
  /** True when `shown` ≠ the earned tier (the span verdict forced a different structure). */
  downgraded: boolean;
  /** True when NOTHING on the ladder spans this water (a ferry, not a bridge) — `shown`
   *  then stays the earned tier purely for display. */
  ferry: boolean;
}

/** Resolve earned tier vs channel width through the REAL span tables (road-use.ts). */
export function shownCrossingTier(earned: CrossingTier, spanTiles: number): ShownTier {
  if (tierSpans(earned, spanTiles)) return { shown: earned, downgraded: false, ferry: false };
  const mv = minViableTier(spanTiles);
  if (mv === null) return { shown: earned, downgraded: false, ferry: true };
  return { shown: mv, downgraded: true, ferry: false };
}
