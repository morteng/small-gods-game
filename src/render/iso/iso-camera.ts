import type { Camera } from '@/core/types';
import { worldToScreen } from './iso-projection';

// Loosened floor (was 0.5) so a large map can be zoomed all the way out to fit.
export const ISO_ZOOM_MIN = 0.05;
// Zoom-in stops at 1:1 (one art pixel per screen pixel). Was 4. See TOPDOWN_ZOOM_MAX.
export const ISO_ZOOM_MAX = 1;

/**
 * Pixel-perfect zoom ladder. 1:1 is the maximum — zooming past native resolution
 * only magnifies the pixel art, so there are no integer rungs above 1. Zooming
 * OUT snaps to unit fractions 1/n (down to 1/20 = ISO_ZOOM_MIN) so the downscale
 * is a uniform nearest-neighbour decimation — crisp. Continuous zoom is retired:
 * every sprite blits at an exact 1/integer scale, killing the fractional-upscale
 * shimmer. Ascending order.
 */
export const ISO_ZOOM_RUNGS: number[] = (() => {
  const rungs: number[] = [];
  for (let n = 20; n >= 2; n--) rungs.push(1 / n); // 0.05 … 0.5
  rungs.push(1);
  return rungs;
})();

/**
 * Snap `z` to the zoom ladder. `dir` 0 → nearest rung; +1 → next rung strictly
 * above `z`; -1 → next rung strictly below. The directional modes let one wheel
 * tick / zoom-button press move exactly one rung (the signature matches the
 * `ZoomQuantizer` consumed by `zoomAt`).
 */
export function quantizeIsoZoom(z: number, dir: -1 | 0 | 1 = 0): number {
  const rungs = ISO_ZOOM_RUNGS;
  const eps = 1e-9;
  if (dir > 0) {
    for (const r of rungs) if (r > z + eps) return r;
    return rungs[rungs.length - 1];
  }
  if (dir < 0) {
    for (let i = rungs.length - 1; i >= 0; i--) if (rungs[i] < z - eps) return rungs[i];
    return rungs[0];
  }
  let best = rungs[0];
  let bestD = Math.abs(z - best);
  for (const r of rungs) {
    const d = Math.abs(z - r);
    if (d < bestD) { best = r; bestD = d; }
  }
  return best;
}

/** Largest ladder rung ≤ z — used for fit-to-view so the whole map still fits. */
export function floorIsoZoom(z: number): number {
  const rungs = ISO_ZOOM_RUNGS;
  let best = rungs[0];
  for (const r of rungs) if (r <= z + 1e-9) best = r;
  return best;
}

export function createIsoCamera(): Camera {
  return { x: 0, y: 0, zoom: 1, dragging: false, lastX: 0, lastY: 0 };
}

export function centerOnTile(
  camera: Camera,
  tx: number, ty: number,
  viewWidth: number, viewHeight: number,
): void {
  const { sx, sy } = worldToScreen(tx, ty, 0, 0, 0);
  camera.x = sx - viewWidth / (2 * camera.zoom);
  camera.y = sy - viewHeight / (2 * camera.zoom);
}

export function clampIsoZoom(z: number): number {
  return Math.max(ISO_ZOOM_MIN, Math.min(ISO_ZOOM_MAX, z));
}
