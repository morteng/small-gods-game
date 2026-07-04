import type { GameState } from '@/core/state';
import type { Viewport } from './viewport';
import { getNpc } from '@/world/npc-helpers';
import { worldToScreen } from '@/render/iso/iso-projection';

/**
 * The camera pans in ISO-SCREEN space: the renderer draws tile (tx,ty) at
 * `worldToScreen(tx,ty,…) − camera.x/y` (gpu-render-frame passes
 * `originX: -camera.x`). Centering a tile therefore means projecting it through
 * the SAME iso transform — never `tile × TILE_SIZE` (that flat mapping is a
 * different space entirely and points the camera at open ocean; the z-lift is
 * deliberately 0 here: centre-on-ground is within half a tile of the lifted
 * sprite and needs no heightfield read).
 */
function cameraTargetFor(tx: number, ty: number, zoom: number, viewport: Viewport): { x: number; y: number } {
  const p = worldToScreen(tx + 0.5, ty + 0.5, 0, 0, 0);
  return {
    x: p.sx - viewport.width / zoom / 2,
    y: p.sy - viewport.height / zoom / 2,
  };
}

/** Smoothly track the followed NPC. Mutates state.camera; clears followNpc if the npc vanished. */
export function applyFollowCamera(state: GameState, viewport: Viewport): void {
  if (!state.followNpc || !state.selectedNpcId || !state.world) return;
  const e = getNpc(state.world, state.selectedNpcId);
  if (!e) { state.followNpc = false; return; }
  const cam = state.camera;
  const target = cameraTargetFor(e.x, e.y, cam.zoom, viewport);
  cam.x += (target.x - cam.x) * 0.15;
  cam.y += (target.y - cam.y) * 0.15;
}

/** Per-frame ease factor for the P5 camera-fly (same 0.15 idiom as the follow cam;
 *  converges in ~0.5 s at display rate). */
const FLY_LERP = 0.15;
/** Settle tolerances (world px / zoom units) — inside these we snap + clear so the
 *  frame loop can idle again. */
const FLY_POS_EPS = 0.5;
const FLY_ZOOM_EPS = 0.002;

/**
 * P5 semantic-zoom: smoothly fly the camera to frame `state.cameraFly`'s tile
 * anchor at its target zoom (set when a zoomed-out alert pin is clicked). Eases
 * `{x, y, zoom}` together and self-terminates (clears `cameraFly`) on arrival.
 * A no-op when no fly is queued; any user pan/zoom clears `cameraFly` upstream so
 * the tween yields to the player at once. Presentation only — never emits a Command.
 */
export function applyCameraFly(state: GameState, viewport: Viewport): void {
  const fly = state.cameraFly;
  if (!fly) return;
  const cam = state.camera;
  // A non-finite fly can never settle (every NaN comparison is false) and its ease
  // writes NaN into the camera — drop it outright.
  if (!Number.isFinite(fly.tx) || !Number.isFinite(fly.ty) || !Number.isFinite(fly.zoom)) {
    state.cameraFly = null;
    return;
  }
  // Self-heal a poisoned camera (NaN never un-eases): snap straight to the target
  // framing instead of easing from nowhere.
  if (!Number.isFinite(cam.x) || !Number.isFinite(cam.y) || !Number.isFinite(cam.zoom)) {
    cam.zoom = fly.zoom;
    const snap = cameraTargetFor(fly.tx, fly.ty, cam.zoom, viewport);
    cam.x = snap.x;
    cam.y = snap.y;
    state.cameraFly = null;
    return;
  }
  // Ease zoom first — the framing offset below reads the current zoom, so blending
  // it in-step keeps the anchor centred throughout the flight.
  cam.zoom += (fly.zoom - cam.zoom) * FLY_LERP;
  const target = cameraTargetFor(fly.tx, fly.ty, cam.zoom, viewport);
  cam.x += (target.x - cam.x) * FLY_LERP;
  cam.y += (target.y - cam.y) * FLY_LERP;
  if (
    Math.abs(fly.zoom - cam.zoom) < FLY_ZOOM_EPS &&
    Math.abs(target.x - cam.x) < FLY_POS_EPS &&
    Math.abs(target.y - cam.y) < FLY_POS_EPS
  ) {
    // Settle: snap the zoom, then re-derive the framing AT that final zoom (the
    // eased target above was computed at the not-quite-final zoom).
    cam.zoom = fly.zoom;
    const snap = cameraTargetFor(fly.tx, fly.ty, cam.zoom, viewport);
    cam.x = snap.x;
    cam.y = snap.y;
    state.cameraFly = null;
  }
}
