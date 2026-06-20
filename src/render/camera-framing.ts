// src/render/camera-framing.ts
//
// Camera FRAMING — compute a camera that fits a set of world targets in the viewport, and
// VERIFY they actually land on screen. This is the primitive the cameraman / presentation
// director uses to frame gameplay actions ("show the crossing", "frame the NPCs in this
// event", "hold the bridge under attack"), and the dev API uses to reliably capture a named
// set of connectome nodes instead of guessing a focus point.
//
// Pure: it returns the camera fields + a coverage report; it does NOT mutate the camera or
// render. Lift-aware (frames the LIFTED terrain surface, like focus-camera), and snaps to
// the pixel-perfect iso zoom ladder. `applyFrame` writes the result onto a live camera.

import type { Camera, GameMap } from '@/core/types';
import { worldToScreen } from './iso/iso-projection';
import { floorIsoZoom, clampIsoZoom } from './iso/iso-camera';
import { tileLiftPx } from '@/render/gpu/terrain-lift';
import { terrainLiftFieldFor } from '@/render/gpu/terrain-field';

/** A target to frame, in tile coordinates (entity x/y are already tile-centred). */
export interface FrameTarget {
  x: number;
  y: number;
}

export interface FrameResult {
  /** Camera fields to apply (iso screen space + zoom rung). */
  x: number;
  y: number;
  zoom: number;
  /** How many targets land inside the viewport at this framing (the verification). */
  onScreen: number;
  total: number;
  coverage: number;
  /** Tile-space bounds of the targets (pre-pad). */
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
}

export interface FrameOptions {
  /** Pass the map to frame the LIFTED surface (high ground stays in frame). */
  map?: GameMap | null;
  /** Context padding around the targets, in tiles (default 2.5). */
  padTiles?: number;
  /** Fraction of the viewport the framed content fills (default 0.85 — a little air). */
  margin?: number;
}

/**
 * Compute a camera framing for `targets`. Projects the targets (and a padded bbox, for
 * context) to iso screen space, fits them into `view` with a margin, snaps the zoom to the
 * ladder, then re-projects each target to count how many actually land on screen. Returns
 * null for an empty target set.
 */
export function frameTargets(
  targets: FrameTarget[],
  viewWidth: number,
  viewHeight: number,
  opts: FrameOptions = {},
): FrameResult | null {
  if (!targets.length || viewWidth <= 0 || viewHeight <= 0) return null;
  const pad = opts.padTiles ?? 2.5;
  const margin = opts.margin ?? 0.85;
  const field = opts.map ? terrainLiftFieldFor(opts.map) : null;
  const lift = (tx: number, ty: number) => (field ? tileLiftPx(field, tx, ty) : 0);

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const t of targets) {
    if (t.x < minX) minX = t.x; if (t.x > maxX) maxX = t.x;
    if (t.y < minY) minY = t.y; if (t.y > maxY) maxY = t.y;
  }

  // Screen-space extent = the targets themselves + the padded tile-bbox corners (so a
  // single point still gets context, and the iso diamond is bounded on both axes).
  const screen: { sx: number; sy: number }[] = targets.map((t) => worldToScreen(t.x, t.y, lift(t.x, t.y), 0, 0));
  const corners: [number, number][] = [
    [minX - pad, minY - pad], [maxX + pad, minY - pad],
    [minX - pad, maxY + pad], [maxX + pad, maxY + pad],
  ];
  for (const [cx, cy] of corners) screen.push(worldToScreen(cx, cy, lift(cx, cy), 0, 0));

  let minSx = Infinity, minSy = Infinity, maxSx = -Infinity, maxSy = -Infinity;
  for (const p of screen) {
    if (p.sx < minSx) minSx = p.sx; if (p.sx > maxSx) maxSx = p.sx;
    if (p.sy < minSy) minSy = p.sy; if (p.sy > maxSy) maxSy = p.sy;
  }

  const spanX = Math.max(1, maxSx - minSx);
  const spanY = Math.max(1, maxSy - minSy);
  // Floor to the zoom ladder (never round UP past the fit, or content overflows).
  const zoom = clampIsoZoom(floorIsoZoom(Math.min((viewWidth * margin) / spanX, (viewHeight * margin) / spanY)));
  const centerSx = (minSx + maxSx) / 2;
  const centerSy = (minSy + maxSy) / 2;
  const camX = centerSx - viewWidth / (2 * zoom);
  const camY = centerSy - viewHeight / (2 * zoom);

  let onScreen = 0;
  for (const t of targets) {
    const w = worldToScreen(t.x, t.y, lift(t.x, t.y), 0, 0);
    const px = (w.sx - camX) * zoom;
    const py = (w.sy - camY) * zoom;
    if (px >= 0 && px <= viewWidth && py >= 0 && py <= viewHeight) onScreen++;
  }

  return {
    x: camX, y: camY, zoom,
    onScreen, total: targets.length, coverage: onScreen / targets.length,
    bbox: { minX, minY, maxX, maxY },
  };
}

/** Write a framing result onto a live camera. */
export function applyFrame(camera: Camera, r: FrameResult): void {
  camera.x = r.x;
  camera.y = r.y;
  camera.zoom = r.zoom;
}
