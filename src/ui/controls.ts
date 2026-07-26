import type { Camera } from '@/core/types';
import { pan, zoomAt, type ZoomQuantizer } from '@/render/camera';
import { pickTile } from '@/ui/pick-tile';
import type { IsoEnv } from '@/render/iso/lifted-projection';
import { resolveActionFromEvent, DEFAULT_KEYMAP, type Keymap } from '@/game/input/keymap';

export interface ControlsCallbacks {
  onTileClick?: (x: number, y: number) => void;
  onCanvasClick?: (sx: number, sy: number) => boolean;
  onTileRightClick?: (tileX: number, tileY: number, screenX: number, screenY: number) => void;
  onRightClick?: (screenX: number, screenY: number) => void;
  onTogglePause?: () => void;
  onToggleLabels?: () => void;
  onToggleDebug?: () => void;
  onToggleFollow?: () => void;
  onToggleSettings?: () => void;
  /** P5b: `photo_mode` — capture a chrome-free photo (the `capture_photo`
   *  meta verb). */
  onPhotoMode?: () => void;
  onToggleDevMode?: () => void;
  onUserCameraInput?: () => void;
  onHoverTile?: (tileX: number, tileY: number, screenX: number, screenY: number) => void;
  /** abilities-v1 B4: asked ONCE at mousedown — does the caller want THIS
   *  left-drag captured as an area-radius gesture instead of an ordinary camera
   *  pan? Only an 'area'-footprint armed cast should return true; the default
   *  (undefined ⇒ false) and a 'point'-footprint cast both fall through to the
   *  pan-or-click path completely unchanged — that regression (a normal drag,
   *  or a point cast, still panning exactly as before) is the one most worth
   *  guarding, since a capture bug here would make the camera unusable. Not
   *  re-polled mid-drag: the armed verb's footprint cannot change while a
   *  mouse button is held. */
  shouldCaptureDrag?: () => boolean;
  /** abilities-v1 B4: fires through a captured area-drag gesture in place of the
   *  pan it preempted. 'start' at mousedown (the disc's anchor tile); 'update'
   *  on every subsequent move while the button stays down (the tile presently
   *  under the cursor — the caller derives the live radius as the distance from
   *  its own remembered anchor, so this module stays ignorant of targeting/
   *  verbs); 'end' at mouseup (the release tile — the caller clamps + emits).
   *  A sub-3px "click" while captured STILL routes here (not onCanvasClick/
   *  onTileClick) — 'start' and 'end' land on nearly the same tile, and the
   *  caller's own radius-from-distance math naturally floors to its minimum,
   *  so a plain click "just works" without a second code path (deliberately
   *  NOT overloading the ordinary 3px click threshold to mean something new). */
  onDragArea?: (phase: 'start' | 'update' | 'end', tileX: number, tileY: number) => void;
  /** Optional terrain env for LIFT-AWARE tile picking (build with `isoEnvForMap`),
   *  evaluated per pick so it tracks the live world. Without it, picking is flat
   *  (height-free) and mis-resolves the tile under the cursor on sloped terrain. */
  getPickEnv?: () => IsoEnv | null;
  /** Optional pixel-perfect zoom snapper (iso mode); evaluated per wheel tick so
   *  it can track the live render mode. Returns undefined → continuous zoom. */
  getZoomQuantize?: () => ZoomQuantizer | undefined;
  /** Optional zoom-in cap override (default = the game's 1:1 pixel-perfect max).
   *  The studio raises this to inspect detail past native resolution. */
  getMaxZoom?: () => number;
  /** P5: the LIVE keybinding map — evaluated per keydown so a rebind takes
   *  effect immediately, with no re-attach. Absent ⇒ `DEFAULT_KEYMAP`. */
  getKeymap?: () => Keymap;
  onRedraw: () => void;
}

// --- Wheel / trackpad zoom tuning -------------------------------------------
// Continuous-zoom sensitivity per (deltaMode-normalized) pixel. The effective
// per-gesture zoom is exp(-Σdy·k), so total zoom tracks the input. Pinch and wheel
// get DIFFERENT constants because their delta scales differ by ~20×: a trackpad
// pinch streams small deltas, while one mouse-wheel notch is a ±100 chunk. Sharing
// the pinch value would make a single notch zoom ~39% (jarring, and it trips the
// clamp below); the gentler wheel value gives ~22%/notch and stays unclamped so
// repeated notches compose proportionally.
const ZOOM_SENS_PINCH = 0.005;   // Mac trackpad pinch (ctrlKey wheel, small deltas) — tune on real hardware
const ZOOM_SENS_WHEEL = 0.0025;  // physical mouse wheel (coarse ±100 notches)
// No single wheel event may zoom more than this factor (guards giant deltas).
const ZOOM_FACTOR_CLAMP = 1.6;
// Snapped (iso) zoom: scroll distance accumulated before stepping one rung.
const QUANTIZED_STEP_PX = 40;

/** Wheel `deltaY` normalized to approximate pixels (deltaMode 1=line, 2=page). */
function normalizeWheelDeltaY(e: WheelEvent, canvas: HTMLCanvasElement): number {
  if (e.deltaMode === 1) return e.deltaY * 16;                       // lines → px
  if (e.deltaMode === 2) return e.deltaY * (canvas.clientHeight || 800); // pages → px
  return e.deltaY;
}

/** Wheel `deltaX` normalized to approximate pixels (deltaMode 1=line, 2=page). */
function normalizeWheelDeltaX(e: WheelEvent, canvas: HTMLCanvasElement): number {
  if (e.deltaMode === 1) return e.deltaX * 16;                      // lines → px
  if (e.deltaMode === 2) return e.deltaX * (canvas.clientWidth || 1200); // pages → px
  return e.deltaX;
}

/**
 * Heuristically tell a physical MOUSE WHEEL from a trackpad two-finger SCROLL.
 * Both fire `wheel` without `ctrlKey` (a trackpad PINCH carries `ctrlKey` and is
 * handled separately, so it never reaches here). A wheel fires coarse, vertical-
 * only notches — a line/page `deltaMode`, or pixel-mode with no horizontal
 * component and an integer `deltaY`. A trackpad pan streams fine, frequently
 * fractional deltas, often with a horizontal component. Imperfect (a pure-vertical
 * trackpad swipe that happens to emit whole-pixel deltas can read as a wheel), but
 * pinch — the trackpad's actual zoom gesture — is unaffected, and this restores
 * the standard desktop "wheel zooms" behaviour.
 */
function isMouseWheel(e: WheelEvent): boolean {
  if (e.deltaMode !== 0) return true;   // lines/pages ⇒ classic wheel
  if (e.deltaX !== 0) return false;     // horizontal component ⇒ trackpad pan
  return Number.isInteger(e.deltaY);    // fractional ⇒ trackpad; integer ⇒ wheel
}

const TEXT_INPUT_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

function isTextInputFocused(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  if (TEXT_INPUT_TAGS.has(el.tagName)) return true;
  const htmlEl = el as HTMLElement;
  // isContentEditable is the spec-compliant boolean; the string fallback
  // (`contentEditable === 'true'`) is a jsdom compatibility shim — jsdom does
  // not populate the reflected boolean property for contenteditable elements,
  // so the string attribute is the only reliable check in that environment.
  return htmlEl.isContentEditable === true || htmlEl.contentEditable === 'true';
}

export function attachControls(canvas: HTMLCanvasElement, camera: Camera, callbacks: ControlsCallbacks): () => void {
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let downX = 0;
  let downY = 0;
  let wheelAccum = 0; // accumulated scroll distance for snapped (iso) zoom
  // abilities-v1 B4: true for the DURATION of a drag that `shouldCaptureDrag`
  // claimed at mousedown — decided once per gesture (not re-polled mid-drag,
  // per the callback's own doc) so a mid-drag arm change can't yank the
  // gesture from pan to area-capture (or back) partway through.
  let capturingArea = false;

  function onMouseDown(e: MouseEvent) {
    // Only the primary button starts a drag/click. Right-click is handled by
    // the contextmenu listener and must not be treated as a left-click.
    if (e.button !== 0) return;
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    downX = e.clientX;
    downY = e.clientY;
    capturingArea = callbacks.shouldCaptureDrag?.() ?? false;
    if (capturingArea) {
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const { tx, ty } = pickTile(camera, sx, sy, callbacks.getPickEnv?.());
      callbacks.onDragArea?.('start', tx, ty);
    }
  }

  function onMouseMove(e: MouseEvent) {
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    // Both the hover callback and a captured area-drag need the tile under the
    // cursor — pick it at most once per move, not twice.
    const needsTile = !!callbacks.onHoverTile || (dragging && capturingArea);
    const tile = needsTile ? pickTile(camera, sx, sy, callbacks.getPickEnv?.()) : null;
    if (callbacks.onHoverTile && tile) callbacks.onHoverTile(tile.tx, tile.ty, sx, sy);
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    if (capturingArea) {
      // The gesture grows a radius, not the camera — pan is suppressed for
      // exactly this drag (a point-footprint cast or nothing armed never sets
      // capturingArea, so it never reaches this branch: the regression test).
      if (tile) callbacks.onDragArea?.('update', tile.tx, tile.ty);
      callbacks.onRedraw();
      return;
    }
    if (dx !== 0 || dy !== 0) callbacks.onUserCameraInput?.();
    pan(camera, dx, dy);
    callbacks.onRedraw();
  }

  function onMouseUp(e: MouseEvent) {
    if (!dragging) return;
    dragging = false;
    if (capturingArea) {
      capturingArea = false;
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const { tx, ty } = pickTile(camera, sx, sy, callbacks.getPickEnv?.());
      callbacks.onDragArea?.('end', tx, ty);
      // An area-drag gesture is consumed here in full, whether it travelled
      // 200px or landed within the ordinary click threshold — it never falls
      // through to onCanvasClick/onTileClick (that 3px threshold keeps its
      // ONE existing meaning: "was this an ordinary click, not a pan").
      return;
    }
    // If barely moved since mousedown, treat as click. Compare against the
    // mousedown position, NOT lastX/lastY (which track the most recent
    // mousemove during a drag and would always read ~0 here).
    const dx = Math.abs(e.clientX - downX);
    const dy = Math.abs(e.clientY - downY);
    if (dx < 3 && dy < 3) {
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      if (callbacks.onCanvasClick?.(sx, sy)) return;
      if (callbacks.onTileClick) {
        const { tx, ty } = pickTile(camera, sx, sy, callbacks.getPickEnv?.());
        callbacks.onTileClick(tx, ty);
      }
    }
  }

  function onContextMenu(e: MouseEvent) {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    if (callbacks.onRightClick) {
      callbacks.onRightClick(sx, sy);
      return;
    }
    if (!callbacks.onTileRightClick) return;
    const { tx, ty } = pickTile(camera, sx, sy, callbacks.getPickEnv?.());
    callbacks.onTileRightClick(tx, ty, sx, sy);
  }

  function onWheel(e: WheelEvent) {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;

    // Gesture split. A trackpad PINCH arrives as a wheel event with `ctrlKey`
    // synthesized by the browser → ZOOM (about the cursor). A physical MOUSE WHEEL
    // (no ctrlKey, but coarse/vertical/integer) also ZOOMS — the standard desktop
    // map control. A trackpad two-finger SCROLL (no ctrlKey, fine/fractional/
    // horizontal) PANS in both axes, the canvas following the fingers.
    if (!e.ctrlKey && !isMouseWheel(e)) {
      const dx = normalizeWheelDeltaX(e, canvas);
      const dy = normalizeWheelDeltaY(e, canvas);
      pan(camera, -dx, -dy);
      callbacks.onUserCameraInput?.();
      callbacks.onRedraw();
      return;
    }

    const dy = normalizeWheelDeltaY(e, canvas);
    const quantize = callbacks.getZoomQuantize?.();
    if (quantize) {
      // Snapped (iso) pinch-zoom steps one rung per accumulated chunk of pinch
      // distance — a trackpad fires a TORRENT of events per gesture, so stepping
      // per-event would be wildly over-sensitive.
      wheelAccum += dy;
      const maxZoom = callbacks.getMaxZoom?.();
      while (Math.abs(wheelAccum) >= QUANTIZED_STEP_PX) {
        // factor is read only for its sign by zoomAt's quantize branch.
        zoomAt(camera, wheelAccum > 0 ? 0.9 : 1.1, cx, cy, quantize, maxZoom);
        wheelAccum -= Math.sign(wheelAccum) * QUANTIZED_STEP_PX;
      }
    } else {
      // Continuous (GPU/topdown) zoom: factor proportional to the gesture
      // MAGNITUDE, with a wheel-vs-pinch sensitivity (their delta scales differ).
      // Exponential mapping keeps zoom perceptually uniform; the product across a
      // gesture's events is exp(-Σdy·k).
      const sens = isMouseWheel(e) ? ZOOM_SENS_WHEEL : ZOOM_SENS_PINCH;
      let factor = Math.exp(-dy * sens);
      factor = Math.max(1 / ZOOM_FACTOR_CLAMP, Math.min(ZOOM_FACTOR_CLAMP, factor));
      zoomAt(camera, factor, cx, cy);
    }
    callbacks.onUserCameraInput?.();
    callbacks.onRedraw();
  }

  /**
   * P5: dispatch by ACTION, not by hardcoded key — `resolveAction` maps the
   * physical code through the live keymap (default or player-rebound), so a
   * rebind here and a rebind in the settings CONTROLS tab are literally the
   * same map, never two copies to keep in sync. Time-control actions
   * (toggle_time_bar/toggle_pause/rate_*), menu-navigation actions and
   * `cancel` are `attachTimeKeys`'/the UI runtime's business, not this
   * handler's — a code that resolves to one of those here is deliberately
   * ignored (falls through the switch) rather than silently doing nothing;
   * each of those has its own handler elsewhere in the input stack.
   */
  function onKeyDown(e: KeyboardEvent) {
    if (isTextInputFocused()) return;
    const action = resolveActionFromEvent(e, callbacks.getKeymap?.() ?? DEFAULT_KEYMAP);
    switch (action) {
      case 'toggle_labels':
        callbacks.onToggleLabels?.();
        break;
      case 'toggle_debug':
        callbacks.onToggleDebug?.();
        break;
      case 'follow_selected':
        callbacks.onToggleFollow?.();
        break;
      case 'open_settings':
        callbacks.onToggleSettings?.();
        break;
      case 'photo_mode':
        callbacks.onPhotoMode?.();
        break;
      default:
        break;
    }
  }

  canvas.addEventListener('mousedown', onMouseDown);
  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mouseup', onMouseUp);
  // Leaving the canvas mid-drag abandons the gesture WITHOUT firing 'end' —
  // an area-drag that never released over the canvas never emits (no
  // half-formed cast from an accidental cursor exit).
  canvas.addEventListener('mouseleave', () => { dragging = false; capturingArea = false; });
  canvas.addEventListener('contextmenu', onContextMenu);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('keydown', onKeyDown);

  // Return cleanup function
  return () => {
    canvas.removeEventListener('mousedown', onMouseDown);
    canvas.removeEventListener('mousemove', onMouseMove);
    canvas.removeEventListener('mouseup', onMouseUp);
    canvas.removeEventListener('contextmenu', onContextMenu);
    canvas.removeEventListener('wheel', onWheel);
    window.removeEventListener('keydown', onKeyDown);
  };
}

// =============================================================================
// Time keyboard shortcuts
// =============================================================================

export interface TimeKeyOptions {
  onToggleTimeBar(): void;
  onTogglePause(): void;
  onSetRate(rate: number): void;
  timeBarOpen(): boolean;
  onEscape(): void;
  /** P5: the LIVE keybinding map, same contract as `ControlsCallbacks.getKeymap`. */
  getKeymap?: () => Keymap;
}

/** `rate_1`/`rate_2`/`rate_4`/`rate_8` → the numeric rate `onSetRate` expects. */
const RATE_FOR_ACTION: Readonly<Record<string, number>> = {
  rate_1: 1, rate_2: 2, rate_4: 4, rate_8: 8,
};

export function attachTimeKeys(target: HTMLElement | Window, opts: TimeKeyOptions): () => void {
  const handler = (e: KeyboardEvent): void => {
    if (isTextInputFocused()) return;
    const action = resolveActionFromEvent(e, opts.getKeymap?.() ?? DEFAULT_KEYMAP);
    if (!action) return;
    if (action === 'toggle_time_bar') {
      e.preventDefault();
      opts.onToggleTimeBar();
      return;
    }
    if (action === 'toggle_pause') {
      e.preventDefault();
      opts.onTogglePause();
      return;
    }
    const rate = RATE_FOR_ACTION[action];
    if (rate !== undefined && opts.timeBarOpen()) {
      e.preventDefault();
      opts.onSetRate(rate);
      return;
    }
    if (action === 'cancel') {
      e.preventDefault();
      opts.onEscape();
      return;
    }
  };
  (target as EventTarget).addEventListener('keydown', handler as EventListener);
  return () => (target as EventTarget).removeEventListener('keydown', handler as EventListener);
}
