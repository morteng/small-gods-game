// src/render/gpu/drag-lod.ts
//
// DRAG-LOD — coarsen the shared terrain+water mesh WHILE the camera is moving.
//
// The water pass is primitive(quad)-bound on weak GPUs and profiles as the single
// most expensive pass; mesh coarsening cuts it ~27× (see terrain-field.ts), and the
// per-pixel waterline (a bicubic clip against the FULL-RES height buffers) stays crisp
// regardless of mesh density. So dropping the mesh one notch during a pan/zoom is a big
// win the eye can't catch (motion hides the coarser silhouette), refining back to full
// res the moment the camera settles.
//
// This is the QUAD-axis complement to two existing controllers that both MISS a
// gameplay-zoom pan: AdaptiveResolution drops RASTER resolution (the fill axis only),
// and zoomCoarsenMaxQuads coarsens the mesh but only once zoomed OUT (sub-pixel tiles).
//
// Pure + deterministic so the decision is unit-tested away from the frame closure; the
// closure owns only the cross-frame state (previous camera pose + the cooldown counter).

/** Coarsen to 1 quad per N×N tiles while moving — 2 is the saturated sweet spot
 *  (terrain-field.ts: the water pass falls ~27× by sub-2; coarser buys little for a
 *  more visible silhouette). */
export const DRAG_LOD_SUB = 2;
/** Screen-px the camera must move in one frame to count as a deliberate pan — above
 *  the sub-pixel drift of a slow camera-follow, below any real drag. */
export const DRAG_LOD_MOTION_PX = 1.5;
/** Frames the coarsening lingers past the last move, so it doesn't flicker off between
 *  the discrete deltas of a drag (≈100 ms @60fps, 200 ms @30fps). */
export const MOTION_COOLDOWN_FRAMES = 6;

export interface CamPose { x: number; y: number; zoom: number }

/**
 * Screen-space distance (px) the camera travelled between two poses. `x`/`y` are world
 * px (pre-zoom), so multiply the delta by the current zoom to get on-screen px. Returns
 * 0 when there's no previous pose (first frame).
 */
export function cameraMotionPx(prev: CamPose | null, cur: CamPose): number {
  if (!prev) return 0;
  return (Math.abs(cur.x - prev.x) + Math.abs(cur.y - prev.y)) * cur.zoom;
}

/**
 * Advance the motion cooldown for this frame. Re-arms to {@link MOTION_COOLDOWN_FRAMES}
 * when the camera panned past {@link DRAG_LOD_MOTION_PX} or its zoom changed; otherwise
 * counts down (never below 0). `> 0` ⇒ the drag-LOD coarsening is active this frame.
 */
export function tickMotionCooldown(prev: CamPose | null, cur: CamPose, prevCooldown: number): number {
  const moved = cameraMotionPx(prev, cur) > DRAG_LOD_MOTION_PX;
  const zoomed = prev != null && cur.zoom !== prev.zoom;
  if (moved || zoomed) return MOTION_COOLDOWN_FRAMES;
  return Math.max(0, prevCooldown - 1);
}

/**
 * The mesh knobs for this frame given whether the drag-LOD is active. When inactive,
 * the natural (zoom-derived) values pass through untouched. When active, force ≥
 * {@link DRAG_LOD_SUB} coarsening: the `maxQuads` cap that makes the grid pick exactly
 * that subsample (terrain + water share these values → waterlines stay aligned), and
 * drop sub-tile subdivision to 1. The cap is min'd with the natural one so a view that's
 * ALREADY coarser than sub-2 (zoomed far out) is never refined by motion.
 */
export function dragLodMesh(
  active: boolean, naturalMaxQuads: number | undefined, naturalSuper: number,
  mapW: number, mapH: number,
): { maxQuads: number | undefined; superSample: number } {
  if (!active) return { maxQuads: naturalMaxQuads, superSample: naturalSuper };
  const motionCap = Math.max(1, Math.floor(mapW / DRAG_LOD_SUB))
    * Math.max(1, Math.floor(mapH / DRAG_LOD_SUB));
  return { maxQuads: Math.min(naturalMaxQuads ?? motionCap, motionCap), superSample: 1 };
}
