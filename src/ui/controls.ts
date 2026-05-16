import type { Camera } from '@/core/types';
import { pan, zoomAt, screenToWorld } from '@/render/camera';
import { TILE_SIZE } from '@/core/constants';

export interface ControlsCallbacks {
  onTileClick?: (x: number, y: number) => void;
  onCanvasClick?: (sx: number, sy: number) => boolean;
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
  return (el as HTMLElement).isContentEditable === true;
}

export function attachControls(canvas: HTMLCanvasElement, camera: Camera, callbacks: ControlsCallbacks): () => void {
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let downX = 0;
  let downY = 0;

  function onMouseDown(e: MouseEvent) {
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
      case 'Space':
        e.preventDefault();
        callbacks.onTogglePause?.();
        break;
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
  canvas.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('keydown', onKeyDown);

  // Return cleanup function
  return () => {
    canvas.removeEventListener('mousedown', onMouseDown);
    canvas.removeEventListener('mousemove', onMouseMove);
    canvas.removeEventListener('mouseup', onMouseUp);
    canvas.removeEventListener('wheel', onWheel);
    window.removeEventListener('keydown', onKeyDown);
  };
}
