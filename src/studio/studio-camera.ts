// src/studio/studio-camera.ts
//
// Shared camera POLICY + fit math for the studios. The studios render the same
// iso pixel-art the game does, so they must pan/zoom through the same primitives
// (`pan`/`zoomAt` in `render/camera.ts`, `attachControls` in `ui/controls.ts`) —
// the only studio-specific piece is the zoom LADDER (a studio zooms one rung PAST
// the game's 1:1 cap to scrutinise detail) and the fit-to-tile-rect helper. This
// module is the one home for both, so object/site/world studios share it instead
// of each re-deriving the iso projection and its own magic-number clamps.

import type { Camera } from '@/core/types';
import { worldToScreen } from '@/render/iso/iso-projection';
import { ISO_ZOOM_MIN, ISO_ZOOM_RUNGS, quantizeToRungs } from '@/render/iso/iso-camera';

/**
 * The studio is an inspection tool, so it zooms one rung PAST the game's 1:1 cap
 * (to 2× native) to scrutinise detail. Fit still snaps to ≤1:1 (pixel-perfect).
 */
export const STUDIO_ZOOM_MAX = 2;

/** The game's pixel-perfect ladder plus the studio's one "past native" rung. */
export const STUDIO_ZOOM_RUNGS = [...ISO_ZOOM_RUNGS, STUDIO_ZOOM_MAX];

/** Snap `z` to the studio ladder (matches the `ZoomQuantizer` shape `zoomAt` wants). */
export const quantizeStudioZoom = (z: number, dir: -1 | 0 | 1 = 0): number =>
  quantizeToRungs(STUDIO_ZOOM_RUNGS, z, dir);

/** Largest studio rung ≤ z — used for fit-to-view so the whole rect still fits AND
 *  the downscale stays a crisp 1/integer decimation (no fractional-scale shimmer). */
export function floorStudioZoom(z: number): number {
  let best = STUDIO_ZOOM_RUNGS[0];
  for (const r of STUDIO_ZOOM_RUNGS) if (r <= z + 1e-9) best = r;
  return best;
}

/**
 * Fit the camera to a tile-space rect. Projects the four corners through the shared
 * iso projector (`worldToScreen`) — never a hand-inlined `(x−y)·HALF_W` copy — then
 * centres and snaps the zoom DOWN to a studio rung. The camera lives in iso-screen
 * space (the GPU scene passes `originX: −camera.x`), so pan/zoom stay consistent.
 */
export function fitTilesToView(
  cam: Camera,
  minTx: number, minTy: number, maxTx: number, maxTy: number,
  vw: number, vh: number, margin = 0.9,
): void {
  const corners: [number, number][] = [[minTx, minTy], [maxTx, minTy], [minTx, maxTy], [maxTx, maxTy]];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [tx, ty] of corners) {
    const { sx, sy } = worldToScreen(tx, ty, 0, 0, 0);
    if (sx < minX) minX = sx;
    if (sx > maxX) maxX = sx;
    if (sy < minY) minY = sy;
    if (sy > maxY) maxY = sy;
  }
  const w = Math.max(1, maxX - minX);
  const hh = Math.max(1, maxY - minY);
  const fit = Math.min(vw / w, vh / hh) * margin;
  cam.zoom = floorStudioZoom(Math.max(ISO_ZOOM_MIN, Math.min(STUDIO_ZOOM_MAX, fit)));
  cam.x = (minX + maxX) / 2 - (vw / 2) / cam.zoom;
  cam.y = (minY + maxY) / 2 - (vh / 2) / cam.zoom;
}
