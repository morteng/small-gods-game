// src/game/framing/compute-frame.ts
//
// ONE reusable camera-framing POLICY: given any subject's tile-space bounding box,
// decide the camera center + zoom that frames it "intelligently, preferring native
// 1:1 zoom when the subject fits the viewport." This is the policy layer the game
// wires four ad-hoc framing call sites onto (focus-camera, fit-camera, flyTo,
// presentation director) — it does not itself touch a live `Camera`; see
// `src/game/camera-follow.ts`'s `cameraTargetFor` for turning a center tile into
// `camera.x/y`, and `src/render/camera-framing.ts`'s `applyFrame` for the sibling
// multi-target verifying fitter this module is *not* trying to replace (that one
// also reports on-screen coverage for a scattered point set + optional terrain
// lift; this one is the simpler single-bbox "prefer 1:1" policy).
//
// Pure: no Math.random, no mutation, no rendering. Reuses the SAME iso diamond
// projection (`worldToScreen`) and the SAME pixel-perfect zoom ladder
// (`floorIsoZoom` / `clampIsoZoom`) as the rest of the camera stack, so results
// are directly camera-follow / iso-camera compatible.

import type { Viewport } from '@/game/viewport';
import { worldToScreen } from '@/render/iso/iso-projection';
import { floorIsoZoom, clampIsoZoom, ISO_ZOOM_MIN, ISO_ZOOM_MAX } from '@/render/iso/iso-camera';

/** World-tile bounding box of the thing to frame (inclusive). A single tile => min===max. */
export interface FrameSubject {
  min: { x: number; y: number };
  max: { x: number; y: number };
}

export interface FrameResult {
  /** Camera center TILE (the bbox center). */
  cx: number;
  cy: number;
  /** Chosen ladder zoom. */
  zoom: number;
}

export interface ComputeFrameOpts {
  /** Fraction of viewport to leave as margin around the subject, PER SIDE (default 0.15 — 30% of the
   *  viewport on each axis stays empty around the content). */
  margin?: number;
  /** Hard ceiling on zoom (default 1 = native 1:1 — the "prefer 1:1" policy). Pass 2 to allow the
   *  magnify rung for a tiny subject. */
  maxZoom?: number;
  /** Floor (default ISO_ZOOM_MIN). */
  minZoom?: number;
}

const DEFAULT_MARGIN = 0.15;
const DEFAULT_MAX_ZOOM = 1;

/**
 * Compute the camera center + zoom that frames `subject` in `viewport`.
 *
 * Policy:
 *  1. Center = the bbox's tile-space midpoint.
 *  2. Project the bbox's four corners through the SAME iso diamond transform used
 *     everywhere else (`worldToScreen`, z=0 — this module is lift-agnostic; callers
 *     framing a lifted subject should pre-adjust like `camera-framing.ts` does) and
 *     take the projected screen-space extent (spanX × spanY). The diamond means a
 *     bbox's screen width depends on (tx-ty) span and its height on (tx+ty) span —
 *     projecting all four corners and taking min/max handles this without hand
 *     -deriving the diagonal formulas (same approach as `frameTargets`).
 *  3. The largest zoom at which that extent still fits inside the viewport with a
 *     margin on both sides of each axis is
 *       fitZoomRaw = min(viewport.width  * (1 - 2*margin) / spanX,
 *                         viewport.height * (1 - 2*margin) / spanY)
 *     (a zero span — a single-point subject — makes that axis's ratio +Infinity,
 *     i.e. "no constraint from this axis," which is exactly what we want.)
 *  4. Snap DOWN to the pixel-perfect ladder (`floorIsoZoom`) so content can only
 *     ever fit more loosely than requested, never overflow.
 *  5. Apply the "prefer 1:1" cap: `zoom = min(fitZoom, maxZoom)` (default maxZoom
 *     1) — a subject that could fit at a rung above native still lands at exactly
 *     1 (pixel-perfect); a subject too big for 1:1 lands at the largest rung that
 *     DOES fit, which is naturally coarser the bigger the subject is.
 *  6. Clamp to [minZoom, maxZoom], then to the absolute iso range as a defensive
 *     floor/ceiling (`clampIsoZoom`).
 *
 * Deterministic + side-effect free.
 */
export function computeFrame(
  subject: FrameSubject,
  viewport: Viewport,
  opts: ComputeFrameOpts = {},
): FrameResult {
  const margin = opts.margin ?? DEFAULT_MARGIN;
  const maxZoom = opts.maxZoom ?? DEFAULT_MAX_ZOOM;
  const minZoom = opts.minZoom ?? ISO_ZOOM_MIN;

  const cx = (subject.min.x + subject.max.x) / 2;
  const cy = (subject.min.y + subject.max.y) / 2;

  const corners: [number, number][] = [
    [subject.min.x, subject.min.y],
    [subject.max.x, subject.min.y],
    [subject.min.x, subject.max.y],
    [subject.max.x, subject.max.y],
  ];
  let minSx = Infinity, minSy = Infinity, maxSx = -Infinity, maxSy = -Infinity;
  for (const [tx, ty] of corners) {
    const { sx, sy } = worldToScreen(tx, ty, 0, 0, 0);
    if (sx < minSx) minSx = sx;
    if (sx > maxSx) maxSx = sx;
    if (sy < minSy) minSy = sy;
    if (sy > maxSy) maxSy = sy;
  }
  const spanX = maxSx - minSx; // 0 for a single-point subject
  const spanY = maxSy - minSy;

  const usableW = viewport.width * (1 - 2 * margin);
  const usableH = viewport.height * (1 - 2 * margin);
  const fitZoomRaw = Math.min(
    spanX > 0 ? usableW / spanX : Infinity,
    spanY > 0 ? usableH / spanY : Infinity,
  );
  const fitZoom = floorIsoZoom(fitZoomRaw);

  let zoom = Math.min(fitZoom, maxZoom);
  zoom = Math.max(minZoom, zoom);
  zoom = clampIsoZoom(zoom);
  // Never exceed the absolute ladder ceiling regardless of a caller-supplied maxZoom.
  zoom = Math.min(zoom, ISO_ZOOM_MAX);

  return { cx, cy, zoom };
}

/**
 * Tile-space bounding box of a point set. Empty input has no meaningful bbox — rather than
 * throw (a subject is often derived from a live NPC/selection list that can legitimately be
 * empty for a frame), this returns a degenerate single-point subject at the origin so callers
 * get a deterministic fallback framing instead of a crash. Callers that need to distinguish
 * "no subject" should check `tiles.length` themselves before calling.
 */
export function subjectFromTiles(tiles: { x: number; y: number }[]): FrameSubject {
  if (tiles.length === 0) return { min: { x: 0, y: 0 }, max: { x: 0, y: 0 } };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const t of tiles) {
    if (t.x < minX) minX = t.x;
    if (t.x > maxX) maxX = t.x;
    if (t.y < minY) minY = t.y;
    if (t.y > maxY) maxY = t.y;
  }
  return { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } };
}
