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
// Continuous pinch-zoom sensitivity per (deltaMode-normalized) pixel of pinch.
// The effective per-gesture zoom is exp(-Σdy·k), so total zoom tracks the pinch.
const ZOOM_SENS_PINCH = 0.005;   // Mac trackpad pinch (ctrlKey wheel, small deltas) — tune on real hardware
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

    // Trackpad gesture split: a PINCH arrives as a wheel event with `ctrlKey`
    // synthesized by the browser → that ZOOMS (about the cursor). A plain
    // two-finger scroll (no ctrlKey) PANS in both axes — the canvas follows the
    // fingers like grabbing the map. (A bare mouse wheel has no ctrlKey, so it
    // pans vertically; pinch is the only zoom path now, per design.)
    if (!e.ctrlKey) {
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
      // Continuous (GPU/topdown) pinch-zoom: factor proportional to the pinch
      // MAGNITUDE. Exponential mapping keeps zoom perceptually uniform; the
      // product across a gesture's events is exp(-Σdy·k).
      let factor = Math.exp(-dy * ZOOM_SENS_PINCH);
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
