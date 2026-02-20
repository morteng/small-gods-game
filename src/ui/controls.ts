import type { Camera } from '@/core/types';
import { pan, zoomAt, screenToWorld } from '@/render/camera';
import { TILE_SIZE } from '@/core/constants';

export interface ControlsCallbacks {
  onTileClick?: (x: number, y: number) => void;
  onRedraw: () => void;
}

export function attachControls(canvas: HTMLCanvasElement, camera: Camera, callbacks: ControlsCallbacks): () => void {
  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  function onMouseDown(e: MouseEvent) {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
  }

  function onMouseMove(e: MouseEvent) {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    pan(camera, dx, dy);
    callbacks.onRedraw();
  }

  function onMouseUp(e: MouseEvent) {
    if (!dragging) return;
    dragging = false;
    // If barely moved, treat as click
    const dx = Math.abs(e.clientX - lastX);
    const dy = Math.abs(e.clientY - lastY);
    if (dx < 3 && dy < 3 && callbacks.onTileClick) {
      const rect = canvas.getBoundingClientRect();
      const { wx, wy } = screenToWorld(camera, e.clientX - rect.left, e.clientY - rect.top, TILE_SIZE);
      callbacks.onTileClick(wx, wy);
    }
  }

  function onWheel(e: WheelEvent) {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    zoomAt(camera, factor, e.clientX - rect.left, e.clientY - rect.top);
    callbacks.onRedraw();
  }

  canvas.addEventListener('mousedown', onMouseDown);
  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mouseup', onMouseUp);
  canvas.addEventListener('mouseleave', () => { dragging = false; });
  canvas.addEventListener('wheel', onWheel, { passive: false });

  // Return cleanup function
  return () => {
    canvas.removeEventListener('mousedown', onMouseDown);
    canvas.removeEventListener('mousemove', onMouseMove);
    canvas.removeEventListener('mouseup', onMouseUp);
    canvas.removeEventListener('wheel', onWheel);
  };
}
