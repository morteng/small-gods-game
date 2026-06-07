import type { Camera } from '@/core/types';
import { TILE_SIZE } from '@/core/constants';
import { centerOn, TOPDOWN_ZOOM_MIN, TOPDOWN_ZOOM_MAX } from './camera';
import { centerOnTile, floorIsoZoom, ISO_ZOOM_MIN, ISO_ZOOM_MAX } from './iso/iso-camera';
import { ISO_TILE_W, ISO_TILE_H } from './iso/iso-constants';
import type { RenderMode } from './select-renderer';

/**
 * Set the camera so the entire map fits in the viewport, centered, with a
 * little margin. Works in both render modes. Caller passes the live viewport.
 *
 * Topdown: the map is a `W*TILE_SIZE × H*TILE_SIZE` rectangle. Iso: the map
 * projects to a diamond spanning `(W+H)*ISO_TILE_W/2 × (W+H)*ISO_TILE_H/2`.
 * Zoom is the smaller of the two fit ratios (× margin), clamped to the mode's
 * loosened floor so even big maps fit.
 */
export function fitCameraToMap(
  camera: Camera,
  mapTilesW: number,
  mapTilesH: number,
  viewWidth: number,
  viewHeight: number,
  mode: RenderMode,
  marginFrac = 0.92,
): void {
  if (mapTilesW <= 0 || mapTilesH <= 0 || viewWidth <= 0 || viewHeight <= 0) return;

  if (mode === 'iso') {
    const spanW = (mapTilesW + mapTilesH) * (ISO_TILE_W / 2);
    const spanH = (mapTilesW + mapTilesH) * (ISO_TILE_H / 2);
    const fit = Math.min(viewWidth / spanW, viewHeight / spanH) * marginFrac;
    // Snap DOWN to a pixel-perfect rung so the whole map still fits.
    camera.zoom = floorIsoZoom(clamp(fit, ISO_ZOOM_MIN, ISO_ZOOM_MAX));
    centerOnTile(camera, mapTilesW / 2, mapTilesH / 2, viewWidth, viewHeight);
  } else {
    const spanW = mapTilesW * TILE_SIZE;
    const spanH = mapTilesH * TILE_SIZE;
    const fit = Math.min(viewWidth / spanW, viewHeight / spanH) * marginFrac;
    camera.zoom = clamp(fit, TOPDOWN_ZOOM_MIN, TOPDOWN_ZOOM_MAX);
    centerOn(camera, (mapTilesW / 2) * TILE_SIZE, (mapTilesH / 2) * TILE_SIZE, viewWidth, viewHeight);
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
