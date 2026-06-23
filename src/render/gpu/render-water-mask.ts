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
 * The RENDER waterType for a world — ocean + lakes from hydrology, rivers re-stamped
 * along the smooth connectome centrelines. Pure; the caller memoises with the colour
 * field (so it rebuilds only on a new world / connectome edit, like the height buffer).
 */
export function buildRenderWaterType(map: GameMap): Uint8Array {
  const hy = getHydrologyResult(map);
  const W = map.width, H = map.height;
  const out = Uint8Array.from(hy.waterType);     // keep ocean (1) + lake (2)
  for (let i = 0; i < out.length; i++) if (out[i] === WaterType.River) out[i] = WaterType.Dry;
  const net = getWaterNetwork(map);
  for (const reach of net.reaches) {
    const r = Math.max(0.5, REACH_CARVE[reach.klass].halfWidth);
    // Centreline points are in cell-centre coords (cell (cx,cy) → (cx+0.5, cy+0.5)).
    for (const p of reach.centerline) stampDisc(out, W, H, p.x, p.y, r);
  }
  return out;
}
