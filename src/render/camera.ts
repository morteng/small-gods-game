import type { Camera } from '@/core/types';

export function createCamera(): Camera {
  return { x: 0, y: 0, zoom: 1, dragging: false, lastX: 0, lastY: 0 };
}

export function screenToWorld(camera: Camera, sx: number, sy: number, tileSize: number): { wx: number; wy: number } {
  const wx = (sx / camera.zoom + camera.x) / tileSize;
  const wy = (sy / camera.zoom + camera.y) / tileSize;
  return { wx: Math.floor(wx), wy: Math.floor(wy) };
}

export function worldToScreen(camera: Camera, wx: number, wy: number, tileSize: number): { sx: number; sy: number } {
  const sx = (wx * tileSize - camera.x) * camera.zoom;
  const sy = (wy * tileSize - camera.y) * camera.zoom;
  return { sx, sy };
}

export function pan(camera: Camera, dx: number, dy: number): void {
  camera.x -= dx / camera.zoom;
  camera.y -= dy / camera.zoom;
}

export function zoomAt(camera: Camera, factor: number, cx: number, cy: number): void {
  const worldX = cx / camera.zoom + camera.x;
  const worldY = cy / camera.zoom + camera.y;
  camera.zoom = Math.max(0.25, Math.min(8, camera.zoom * factor));
  camera.x = worldX - cx / camera.zoom;
  camera.y = worldY - cy / camera.zoom;
}

export function centerOn(camera: Camera, worldX: number, worldY: number, viewWidth: number, viewHeight: number): void {
  camera.x = worldX - (viewWidth / camera.zoom) / 2;
  camera.y = worldY - (viewHeight / camera.zoom) / 2;
}
