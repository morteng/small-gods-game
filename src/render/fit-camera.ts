import type { Camera } from '@/core/types';
import { centerOnTile, floorIsoZoom, ISO_ZOOM_MIN, ISO_ZOOM_MAX } from './iso/iso-camera';
import { ISO_TILE_W, ISO_TILE_H } from './iso/iso-constants';

/**
 * Set the camera so the entire map fits in the viewport, centered, with a
 * little margin. Caller passes the live viewport.
 *
 * The renderer is iso-projected: the map projects to a diamond spanning
 * `(W+H)*ISO_TILE_W/2 × (W+H)*ISO_TILE_H/2`. Zoom is the smaller of the two fit
 * ratios (× margin), snapped DOWN to a pixel-perfect rung so the whole map fits.
 * (The topdown branch died with the WebGPU-only cut.)
 */
export function fitCameraToMap(
  camera: Camera,
  mapTilesW: number,
  mapTilesH: number,
  viewWidth: number,
  viewHeight: number,
  marginFrac = 0.92,
): void {
  if (mapTilesW <= 0 || mapTilesH <= 0 || viewWidth <= 0 || viewHeight <= 0) return;

  const spanW = (mapTilesW + mapTilesH) * (ISO_TILE_W / 2);
  const spanH = (mapTilesW + mapTilesH) * (ISO_TILE_H / 2);
  const fit = Math.min(viewWidth / spanW, viewHeight / spanH) * marginFrac;
  camera.zoom = floorIsoZoom(clamp(fit, ISO_ZOOM_MIN, ISO_ZOOM_MAX));
  centerOnTile(camera, mapTilesW / 2, mapTilesH / 2, viewWidth, viewHeight);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
