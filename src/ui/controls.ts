import type { Camera } from '@/core/types';
import { pan, zoomAt, screenToWorld } from '@/render/camera';
import { TILE_SIZE } from '@/core/constants';

export interface ControlsCallbacks {
  onTileClick?: (x: number, y: number) => void;
  onCanvasClick?: (sx: number, sy: number) => boolean;
  onTileRightClick?: (tileX: number, tileY: number, screenX: number, screenY: number) => void;
  onTogglePause?: () => void;
  onToggleLabels?: () => void;
  onTogglePoiMarkers?: () => void;
  onToggleDebug?: () => void;
  onToggleFollow?: () => void;
  onToggleSettings?: () => void;
  onUserCameraInput?: () => void;
  onHoverTile?: (tileX: number, tileY: number, screenX: number, screenY: number) => void;
  onRedraw: () => void;
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
      const { wx, wy } = screenToWorld(camera, sx, sy, TILE_SIZE);
      callbacks.onHoverTile(wx, wy, sx, sy);
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
        const { wx, wy } = screenToWorld(camera, sx, sy, TILE_SIZE);
        callbacks.onTileClick(wx, wy);
      }
    }
  }

  function onContextMenu(e: MouseEvent) {
    if (!callbacks.onTileRightClick) return;
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const { wx, wy } = screenToWorld(camera, sx, sy, TILE_SIZE);
    callbacks.onTileRightClick(wx, wy, sx, sy);
  }

  function onWheel(e: WheelEvent) {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    zoomAt(camera, factor, e.clientX - rect.left, e.clientY - rect.top);
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
        callbacks.onTogglePoiMarkers?.();
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
