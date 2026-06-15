import type { Camera } from '@/core/types';
import { centerOnTile } from './iso/iso-camera';

/**
 * Center the camera on a tile, zoom-aware. The renderer is iso-projected, so
 * `camera.x/y` live in iso screen space — centering routes through the iso
 * helper. (The old topdown branch died with the WebGPU-only cut.)
 *
 * `+0.5` targets the tile's center rather than its top/left corner.
 */
export function focusCameraOnTile(
  camera: Camera,
  tileX: number,
  tileY: number,
  viewWidth: number,
  viewHeight: number,
): void {
  centerOnTile(camera, tileX + 0.5, tileY + 0.5, viewWidth, viewHeight);
}
