// src/world/road-occupancy-mask.ts
//
// Width-aware road occupancy: the SAME analytic ribbon the renderer paints
// (`buildRoadFeatureGeometry` / `render/gpu/feature-geometry.ts`), sampled at tile
// resolution so placement/growth code can ask "does a building HERE overlap the
// rendered road?" — instead of the bare centerline tile-grid test
// (`ROAD_TYPES.has(tile.type)`), which only tests the 1-cell-wide walked path and
// misses everything the ribbon paints beyond it (up to ~1.44 tiles per side for a
// highway — `maxCarriageHalfWidth`, road-state.ts).
//
// Pure + deterministic: reuses `getRoadFeatureGeometry`'s cached ribbon and
// `segDist`'s closest-point math, so this test can never drift from what the GPU
// terrain pass actually paints.

import type { GameMap } from '@/core/types';
import {
  getRoadFeatureGeometry, buildRoadFeatureGeometry, segDist, FEATURE_SEG_STRIDE,
  type RoadFeatureGeometry,
} from '@/render/gpu/feature-geometry';

/** Default extra margin (tiles) beyond the ribbon's own edge — a building keeps a
 *  visible gap from the road rather than exactly kissing the shoulder. */
export const DEFAULT_ROAD_CLEARANCE_TILES = 0.5;

export interface RoadOccupancyMask {
  /** True when tile (x, y)'s CENTRE is inside the rendered ribbon, or within
   *  `clearanceTiles` of it. */
  has(x: number, y: number): boolean;
}

function isOccupiedAt(geo: RoadFeatureGeometry, x: number, y: number, clearanceTiles: number): boolean {
  if (geo.segCount === 0) return false;
  const bx = Math.min(geo.nbx - 1, Math.max(0, Math.floor(x / geo.bucketTiles)));
  const by = Math.min(geo.nby - 1, Math.max(0, Math.floor(y / geo.bucketTiles)));
  const b = by * geo.nbx + bx;
  const s = geo.segments;
  for (let p = geo.bucketOffset[b]; p < geo.bucketOffset[b + 1]; p++) {
    const o = geo.bucketSegs[p] * FEATURE_SEG_STRIDE;
    const { t, d } = segDist(s[o], s[o + 1], s[o + 2], s[o + 3], x, y);
    // The segment's own half-width already carries the shoulder lip (`buildRoadFeatureGeometry`
    // packs `carriageHalf + SHOULDER_LIP_TILES` as its stored half) — this test just adds the
    // caller's extra margin on top, so a tile "on the road" (pavedness > 0) is always covered by
    // `d <= half`, matching the spec's "roadPavednessAt > 0 OR within half + clearance" test.
    const half = s[o + 4] * (1 - t) + s[o + 5] * t;
    if (d <= half + clearanceTiles) return true;
  }
  return false;
}

/**
 * Build a tile-resolution occupancy test over the SAME analytic ribbon the renderer
 * paints (`getRoadFeatureGeometry`). `clearanceTiles` pads the ribbon's already
 * shoulder-lipped edge (`SHOULDER_LIP_TILES` is baked into the stored segment
 * half-width) with an extra margin — default `DEFAULT_ROAD_CLEARANCE_TILES` (half a
 * tile) so placement keeps a visible gap rather than exactly kissing the shoulder.
 */
export function buildRoadOccupancyMask(
  map: GameMap, clearanceTiles: number = DEFAULT_ROAD_CLEARANCE_TILES,
): RoadOccupancyMask {
  const geo = getRoadFeatureGeometry(map);
  return {
    has(x: number, y: number): boolean {
      return isOccupiedAt(geo, x, y, clearanceTiles);
    },
  };
}

/**
 * As `buildRoadOccupancyMask`, but derives the ribbon geometry DIRECTLY (no memo). For
 * MID-WORLDGEN callers (crossing-structure siting in `map-generator.ts`) that only have a
 * partial map view: the memo keys on `seed:dims:roadGraph.rev`, so a cached entry built
 * BEFORE the anchor-link / fillet-reconciliation passes would collide with — and poison —
 * the final map's entry the renderer reads. The ribbon here misses only the later anchor
 * fillets (sub-tile reshaping near doors); the default half-tile clearance absorbs that
 * drift, and the `buildings.off-roads-ribbon` contract re-checks against the FINAL ribbon.
 */
export function buildRoadOccupancyMaskUncached(
  map: GameMap, clearanceTiles: number = DEFAULT_ROAD_CLEARANCE_TILES,
): RoadOccupancyMask {
  const geo = buildRoadFeatureGeometry(map);
  return {
    has(x: number, y: number): boolean {
      return isOccupiedAt(geo, x, y, clearanceTiles);
    },
  };
}
