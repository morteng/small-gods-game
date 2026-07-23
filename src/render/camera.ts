import type { Camera } from '@/core/types';

// Loosened floor (was 0.25) so a large map can be zoomed all the way out to fit.
export const TOPDOWN_ZOOM_MIN = 0.05;
// Zoom-in stops at native 1:1 — one art pixel per screen pixel, the hard cap every
// mode clamps through `zoomAt`. The 2× magnify rung was removed (user: "stop at zoom
// 1:1, going to 2x is confusing"). Keep in step with ISO_ZOOM_MAX.
export const TOPDOWN_ZOOM_MAX = 1;

export function createCamera(): Camera {
  return { x: 0, y: 0, zoom: 1, dragging: false, lastX: 0, lastY: 0 };
}

export function screenToWorld(camera: Camera, sx: number, sy: number, tileSize: number): { wx: number; wy: number } {
  const wx = (sx / camera.zoom + camera.x) / tileSize;
  const wy = (sy / camera.zoom + camera.y) / tileSize;
  return { wx: Math.floor(wx), wy: Math.floor(wy) };
}

export function worldToScreen(camera: Camera, wx: number, wy: number, tileSize: number): { sx: number; sy: number } {
  const sx = (wx * tileSize - camera.x) * camera.zoom;
  const sy = (wy * tileSize - camera.y) * camera.zoom;
  return { sx, sy };
}

export function pan(camera: Camera, dx: number, dy: number): void {
  camera.x -= dx / camera.zoom;
  camera.y -= dy / camera.zoom;
}

/**
 * Maps the current zoom to a snapped value. `dir` reflects the gesture
 * direction (+1 zooming in, -1 out, 0 neutral) so a quantizer can step exactly
 * one rung per call rather than multiplying. See `quantizeIsoZoom`.
 */
export type ZoomQuantizer = (current: number, dir: -1 | 0 | 1) => number;

export function zoomAt(
  camera: Camera, factor: number, cx: number, cy: number, quantize?: ZoomQuantizer,
  maxZoom: number = TOPDOWN_ZOOM_MAX,
): void {
  const worldX = cx / camera.zoom + camera.x;
  const worldY = cy / camera.zoom + camera.y;
  const z = quantize
    ? quantize(camera.zoom, factor > 1 ? 1 : factor < 1 ? -1 : 0)
    : camera.zoom * factor;
  camera.zoom = Math.max(TOPDOWN_ZOOM_MIN, Math.min(maxZoom, z));
  camera.x = worldX - cx / camera.zoom;
  camera.y = worldY - cy / camera.zoom;
}

export function centerOn(camera: Camera, worldX: number, worldY: number, viewWidth: number, viewHeight: number): void {
  camera.x = worldX - (viewWidth / camera.zoom) / 2;
  camera.y = worldY - (viewHeight / camera.zoom) / 2;
}
