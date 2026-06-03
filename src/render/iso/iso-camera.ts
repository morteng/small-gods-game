import type { Camera } from '@/core/types';
import { worldToScreen } from './iso-projection';

// Loosened floor (was 0.5) so a large map can be zoomed all the way out to fit.
export const ISO_ZOOM_MIN = 0.05;
export const ISO_ZOOM_MAX = 4;

export function createIsoCamera(): Camera {
  return { x: 0, y: 0, zoom: 1, dragging: false, lastX: 0, lastY: 0 };
}

export function centerOnTile(
  camera: Camera,
  tx: number, ty: number,
  viewWidth: number, viewHeight: number,
): void {
  const { sx, sy } = worldToScreen(tx, ty, 0, 0, 0);
  camera.x = sx - viewWidth / (2 * camera.zoom);
  camera.y = sy - viewHeight / (2 * camera.zoom);
}

export function clampIsoZoom(z: number): number {
  return Math.max(ISO_ZOOM_MIN, Math.min(ISO_ZOOM_MAX, z));
}
