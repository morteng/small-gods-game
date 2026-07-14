// src/world/render-water.ts
//
// THE "is there water the player can SEE here?" predicate — the ONE render-water truth every
// consumer that must agree with the drawn channel reads (mill-site WCV-87 pattern, generalised).
//
// Why this exists: `map.tiles[y][x].type` is NOT the visible water. Two independent lies:
//   * roads CARVE 'bridge'/'dirt_road' straight over the channel at a crossing, so the tile grid
//     forgets there was ever water exactly where the crossing is;
//   * the drawn river is the connectome ribbon (`buildRenderWaterType` — the W ∝ √Q disc swath
//     along each reach's smoothed centreline, the same curve the carve follows), which meanders
//     up to a tile off the D8 raster line the tiles were classified from.
// A consumer reading the raster therefore sites decks beside the water, paints cobble across it,
// and lints a symptom instead of the cause. Everything that must line up with the DRAWN water —
// crossing bank siting, the road ribbon's yield-to-river, the bridge lint — reads THIS.
//
// Render water = the connectome ribbon (river discs + ocean + lakes) UNION the standing water the
// tile grid still carries. The union is what makes it a strict superset of the tile raster: a cell
// that is render-DRY is tile-dry too, so a bank seated on render-dry ground is seated, full stop.
//
// Pure + map-derived (never persisted): `buildRenderWaterTypeMemo` re-derives from the hydrology
// raster + water connectome, both themselves memoised views of (seed, dims). So this returns the
// same answer at worldgen, after a save/load, in the renderer and in the linter.

import type { GameMap } from '@/core/types';
import { WaterType } from '@/core/types';
import { WATER_TYPES } from '@/core/constants';
import { buildRenderWaterTypeMemo } from '@/render/gpu/render-water-mask';

/** "Is (x,y) water the player can see?" — off-map reads false. */
export type WaterPredicate = (x: number, y: number) => boolean;

/**
 * The render-water predicate for a map. Memoised through `buildRenderWaterTypeMemo` (seed+dims
 * keyed), so calling this per-edge / per-cell is cheap. A map with no hydrology (studio ground,
 * bare test stub) degrades to the tile grid alone, which is exactly right there — no connectome,
 * no ribbon, so the tiles ARE the visible water.
 */
export function getRenderWaterMask(map: GameMap): WaterPredicate {
  const W = map.width, H = map.height;
  let ribbon: Uint8Array | null = null;
  try {
    ribbon = buildRenderWaterTypeMemo(map);
  } catch {
    ribbon = null;   // no hydrology on this map — tiles are the only water signal
  }
  return (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= W || y >= H) return false;
    if (ribbon && ribbon[y * W + x] !== WaterType.Dry) return true;
    // `tiles` is optional-chained throughout: a partial map view (the road-occupancy mask
    // worldgen builds mid-generation, a bare render fixture) legitimately carries no tile grid.
    return WATER_TYPES.has(map.tiles?.[y]?.[x]?.type ?? '');
  };
}
