// src/render/gpu/connectome-water.ts
//
// The ONE connectome→render-water projection (the surface half of the unification).
// Given an EDITED water network (author-placed / moved lakes the hydrology raster
// never knew), project it to a `ConnectomeWaterOverride`: the render classification
// (`buildRenderWaterType`) AND the still-water SURFACE — each placed lake filled to
// its spill lip in render-elevation space. Both the studio render context and the
// tests build the override through here, so the projection lives in exactly one place
// (was duplicated inline in world-studio + the test harness).
//
// Pure + deterministic from (map, net): no GPU/DOM, no caching (the caller memoises by
// the world edit version). The classification half is byte-identical to the raster for
// a base (unedited) net — see `buildRenderWaterType`.

import type { GameMap, ConnectomeWaterOverride } from '@/core/types';
import type { WaterNetwork } from '@/terrain/river-network';
import { buildRenderWaterType } from '@/render/gpu/render-water-mask';
import { curveHeightBuffer } from '@/render/gpu/terrain-field';
import { getHeightfield, ELEVATION_SEA_LEVEL } from '@/world/heightfield';
import { styledIslandSpec } from '@/terrain/island-mask';
import { styledShapeSpec } from '@/terrain/terrain-shape';
import { worldStyleOf } from '@/core/world-style';

/** Metres the placed-lake surface sits below its spill lip (a contained sheet). */
const LAKE_LIP_INSET_M = 0.5;

/**
 * Project an edited water network to the render-water override (classification +
 * still-water surface). Each connectome lake body is filled to its SPILL LIP — the
 * lowest natural (uncarved) render grade on its shore ring — minus a small inset, so
 * the sheet sits just under the surrounding ground rather than on the carved basin
 * floor. `version` is the world edit version the caller bumps per edit (the render
 * caches key off it). Returns the override for any net; for a base net the surface is
 * empty (no placed lakes) and the classification matches the raster.
 */
export function buildConnectomeWaterOverride(
  map: GameMap, net: WaterNetwork, version: number,
): ConnectomeWaterOverride {
  const W = map.width, H = map.height;
  const style = worldStyleOf(map.worldSeed);
  const waterType = buildRenderWaterType(map, net);

  // The natural (uncarved) curved render grade — the bank reference for the fill, so a
  // placed lake fills to the SURROUNDING ground lip, not the carved basin floor.
  const base = curveHeightBuffer(
    getHeightfield(map.seed, W, H, styledIslandSpec(map.worldSeed), map.worldSeed?.pois ?? null, styledShapeSpec(map.worldSeed)),
    ELEVATION_SEA_LEVEL, style.terrainHeightGamma,
  );
  const insetN = LAKE_LIP_INSET_M / style.mountainRelief;
  const lakeSurface = new Float32Array(W * H);
  for (const lake of net.lakes) {
    const body = new Set(lake.cells);
    let lip = Infinity;
    for (const c of lake.cells) {
      const x = c % W, y = (c / W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const n = ny * W + nx;
        if (!body.has(n)) lip = Math.min(lip, base[n]);
      }
    }
    // A lake touching the map edge (no dry shore ring) falls back to its own floor.
    if (!Number.isFinite(lip)) for (const c of lake.cells) lip = Math.min(lip, base[c]);
    const surf = lip - insetN;
    for (const c of lake.cells) lakeSurface[c] = surf;
  }
  return { waterType, lakeSurface, version };
}
