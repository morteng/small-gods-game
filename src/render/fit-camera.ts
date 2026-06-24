import type { Camera } from '@/core/types';
import { centerOnTile, floorIsoZoom, ISO_ZOOM_MIN, ISO_ZOOM_MAX } from './iso/iso-camera';
import { ISO_TILE_W, ISO_TILE_H } from './iso/iso-constants';
import { clamp } from '@/core/math';

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

/**
 * Clamp the camera so the island can never be panned/zoomed fully off-screen.
 * Call after any camera move (drag-pan, wheel-zoom, follow). Iso bbox of the
 * `z = 0` map plane:  x ∈ [−H·halfW, W·halfW],  y ∈ [0, (W+H)·halfH].
 *
 * Classic 2D world clamp per axis (the bbox-overlap variant fails here because
 * the map is a DIAMOND inside its bbox, so a bbox-corner overlap shows only a
 * thin ocean tip): when the map is LARGER than the viewport on an axis, keep the
 * viewport INSIDE the bbox so you can't pan past the shore into open sea; when
 * it's SMALLER (zoomed out), centre it. Ocean fills any bbox-corner triangles.
 */
export function clampCameraToMap(
  camera: Camera,
  mapTilesW: number,
  mapTilesH: number,
  viewWidth: number,
  viewHeight: number,
): void {
  if (mapTilesW <= 0 || mapTilesH <= 0 || viewWidth <= 0 || viewHeight <= 0 || camera.zoom <= 0) return;
  const halfW = ISO_TILE_W / 2, halfH = ISO_TILE_H / 2;
  camera.x = clampAxis(camera.x, viewWidth / camera.zoom, -mapTilesH * halfW, mapTilesW * halfW);
  camera.y = clampAxis(camera.y, viewHeight / camera.zoom, 0, (mapTilesW + mapTilesH) * halfH);
}

/** Clamp one axis: viewport `[c, c+view]` stays inside the map span `[m0, m1]`
 *  when the map is bigger than the view; centred when it's smaller. */
function clampAxis(c: number, view: number, m0: number, m1: number): number {
  if (view >= m1 - m0) return (m0 + m1) / 2 - view / 2; // map fits → centre
  return Math.max(m0, Math.min(m1 - view, c));          // map bigger → keep viewport inside
}
