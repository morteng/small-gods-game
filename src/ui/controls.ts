import type { Camera } from '@/core/types';
import { pan, zoomAt, type ZoomQuantizer } from '@/render/camera';
import { pickTile } from '@/ui/pick-tile';

export interface ControlsCallbacks {
  onTileClick?: (x: number, y: number) => void;
  onCanvasClick?: (sx: number, sy: number) => boolean;
  onTileRightClick?: (tileX: number, tileY: number, screenX: number, screenY: number) => void;
  onRightClick?: (screenX: number, screenY: number) => void;
  onTogglePause?: () => void;
  onToggleLabels?: () => void;
  onTogglePoiMarkers?: () => void;
  onToggleDebug?: () => void;
  onToggleFollow?: () => void;
  onToggleSettings?: () => void;
  onToggleMinimap?: () => void;
  onShowTutorial?: () => void;
  onToggleDevMode?: () => void;
  onUserCameraInput?: () => void;
  onHoverTile?: (tileX: number, tileY: number, screenX: number, screenY: number) => void;
  /** Optional pixel-perfect zoom snapper (iso mode); evaluated per wheel tick so
   *  it can track the live render mode. Returns undefined → continuous zoom. */
  getZoomQuantize?: () => ZoomQuantizer | undefined;
  /** Optional zoom-in cap override (default = the game's 1:1 pixel-perfect max).
   *  The studio raises this to inspect detail past native resolution. */
  getMaxZoom?: () => number;
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

  function onMouseDown(e: MouseEvent) {
    // Only the primary button starts a drag/click. Right-click is handled by
    // the contextmenu listener and must not be treated as a left-click.
    if (e.button !== 0) return;
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    downX = e.clientX;
    downY = e.clientY;
  }

  function onMouseMove(e: MouseEvent) {
    if (callbacks.onHoverTile) {
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const { tx, ty } = pickTile(camera, sx, sy);
      callbacks.onHoverTile(tx, ty, sx, sy);
    }
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    if (dx !== 0 || dy !== 0) callbacks.onUserCameraInput?.();
    pan(camera, dx, dy);
    callbacks.onRedraw();
  }

  function onMouseUp(e: MouseEvent) {
    if (!dragging) return;
    dragging = false;
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
        const { tx, ty } = pickTile(camera, sx, sy);
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
    const { tx, ty } = pickTile(camera, sx, sy);
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

  function onKeyDown(e: KeyboardEvent) {
    if (isTextInputFocused()) return;
    switch (e.code) {
      case 'KeyL':
        callbacks.onToggleLabels?.();
        break;
      case 'KeyM':
        // Toggle minimap (new) or POI markers (old) — check callback
        if (callbacks.onToggleMinimap) {
          callbacks.onToggleMinimap();
        } else {
          callbacks.onTogglePoiMarkers?.();
        }
        break;
      case 'Backquote':
        callbacks.onToggleDebug?.();
        break;
      case 'KeyF':
        callbacks.onToggleFollow?.();
        break;
      case 'KeyK':
        callbacks.onToggleSettings?.();
        break;
      case 'Slash':
        // '?' key (Shift+/ = ?)
        if (e.shiftKey) {
          callbacks.onShowTutorial?.();
        }
        break;
    }
  }

  canvas.addEventListener('mousedown', onMouseDown);
  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mouseup', onMouseUp);
  canvas.addEventListener('mouseleave', () => { dragging = false; });
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
}

export function attachTimeKeys(target: HTMLElement | Window, opts: TimeKeyOptions): () => void {
  const handler = (e: KeyboardEvent): void => {
    if (isTextInputFocused()) return;
    if (e.key === 't' || e.key === 'T') {
      e.preventDefault();
      opts.onToggleTimeBar();
      return;
    }
    if (e.key === ' ') {
      e.preventDefault();
      opts.onTogglePause();
      return;
    }
    if (['1', '2', '4', '8'].includes(e.key) && opts.timeBarOpen()) {
      e.preventDefault();
      opts.onSetRate(Number(e.key));
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      opts.onEscape();
      return;
    }
  };
  (target as EventTarget).addEventListener('keydown', handler as EventListener);
  return () => (target as EventTarget).removeEventListener('keydown', handler as EventListener);
}
