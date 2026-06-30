// src/render/gpu/render-water-mask.ts
//
// River-ribbon retirement: the VISIBLE river follows the smooth connectome, not the
// D8 raster. The hydrology `waterType` classifies each cell by 8-direction drainage,
// so a diagonal river is a 90° staircase — and the terrain bed-colour pass paints
// exactly those staircased cells damp. Here we re-derive a RENDER waterType: keep
// ocean + lake (area blobs, already smooth), but DROP the raster river cells and
// re-stamp rivers as a swath along each reach's CHaikin-smoothed centreline (the
// same curve the carve follows), at the reach's channel half-width. The bed colour
// then reads as a bendy river, matching the carved valley.
//
// The hydrology raster stays the source of truth for the sim, the ribbon flow and
// the water-surface level; this is a pure, memoised RENDER overlay only.

import type { GameMap } from '@/core/types';
import { WaterType } from '@/core/types';
import { getHydrologyResult } from '@/world/hydrology-store';
import { getWaterNetwork } from '@/world/water-network-store';
import { REACH_CARVE } from '@/world/river-deformation';
import { referenceFlow, reachHalfWidths, type WaterNetwork } from '@/terrain/river-network';

/** Stamp every cell whose centre is within `r` tiles of (px,py) as River, but only
 *  where the cell is currently Dry (never paint over ocean or a lake basin). */
function stampDisc(out: Uint8Array, W: number, H: number, px: number, py: number, r: number): void {
  const r2 = r * r;
  const x0 = Math.max(0, Math.floor(px - r)), x1 = Math.min(W - 1, Math.ceil(px + r));
  const y0 = Math.max(0, Math.floor(py - r)), y1 = Math.min(H - 1, Math.ceil(py + r));
  for (let cy = y0; cy <= y1; cy++) {
    const dy = cy + 0.5 - py;
    for (let cx = x0; cx <= x1; cx++) {
      const dx = cx + 0.5 - px;
      if (dx * dx + dy * dy > r2) continue;
      const i = cy * W + cx;
      if (out[i] === WaterType.Dry) out[i] = WaterType.River;
    }
  }
}

/**
 * The RENDER waterType for a world — ocean from hydrology, rivers AND lakes re-stamped
 * from the water CONNECTOME (the smooth centrelines + lake bodies). Pass an explicit
 * `net` to render an EDITED connectome (a placed/moved lake): the mask then includes
 * author-placed lakes the hydrology raster never knew, so they paint as real still
 * water through the same path as generated lakes. Defaults to the base network — then
 * it is byte-identical to the raster for generated worlds (connectome lakes overlap the
 * raster lake cells). Pure; the caller memoises.
 */
export function buildRenderWaterType(map: GameMap, net: WaterNetwork = getWaterNetwork(map)): Uint8Array {
  const hy = getHydrologyResult(map);
  const W = map.width, H = map.height;
  const out = Uint8Array.from(hy.waterType);     // keep ocean (1) + lake (2)
  for (let i = 0; i < out.length; i++) if (out[i] === WaterType.River) out[i] = WaterType.Dry;
  const refFlow = referenceFlow(net);
  for (const reach of net.reaches) {
    // Stamp at the per-vertex channel width (W ∝ √Q) so the visible river widens from a
    // thin spring to a broad mouth and steps up at confluences — the per-class constant
    // painted a uniform ribbon end-to-end. Matches the carve (river-deformation) exactly.
    const halfWidths = reachHalfWidths(reach, refFlow);
    // Centreline points are in cell-centre coords (cell (cx,cy) → (cx+0.5, cy+0.5)).
    reach.centerline.forEach((p, i) => {
      const r = Math.max(0.5, halfWidths[i] ?? REACH_CARVE[reach.klass].halfWidth);
      stampDisc(out, W, H, p.x, p.y, r);
    });
  }
  // Lake bodies from the connectome (after rivers, so a lake wins where they overlap).
  // Generated lakes already match the raster Lake cells; placed lakes are the new ones.
  for (const lake of net.lakes) {
    for (const c of lake.cells) if (out[c] !== WaterType.Ocean) out[c] = WaterType.Lake;
  }
  return out;
}

// Memoise by (seed, dims) like the sibling river stores — the mask is static for a
// world, so per-mouse-move readout lookups (and the colour-field build) reuse it.
const cache = new Map<string, Uint8Array>();
const CACHE_CAP = 4;

/** The memoised render waterType for a world. Cheap to call repeatedly (hover readout). */
export function buildRenderWaterTypeMemo(map: GameMap): Uint8Array {
  const k = `${map.seed}:${map.width}x${map.height}`;
  let m = cache.get(k);
  if (m) return m;
  m = buildRenderWaterType(map);
  cache.set(k, m);
  if (cache.size > CACHE_CAP) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return m;
}

/** Drop the memoised masks (tests; harmless in prod). */
export function clearRenderWaterTypeCache(): void {
  cache.clear();
}
