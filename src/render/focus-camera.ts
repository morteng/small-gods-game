import type { Camera } from '@/core/types';
import { TILE_SIZE } from '@/core/constants';
import { centerOn } from './camera';
import { centerOnTile } from './iso/iso-camera';
import type { RenderMode } from './select-renderer';

/**
 * Center the camera on a tile, accounting for the active render mode AND zoom.
 *
 * The old dev focus handler reimplemented camera math as `tile * TILE_SIZE -
 * viewport/2`, which (a) ignored zoom and (b) assumed topdown world-pixel
 * coordinates — but the game defaults to iso, where `camera.x/y` live in
 * iso-projected screen space. So focusing jumped to a nonsensical spot. This
 * routes through the mode-appropriate, zoom-aware centering helper instead.
 *
 * `+0.5` targets the tile's center rather than its top/left corner.
 */
export function focusCameraOnTile(
  camera: Camera,
  tileX: number,
  tileY: number,
  viewWidth: number,
  viewHeight: number,
  mode: RenderMode,
): void {
  const cx = tileX + 0.5;
  const cy = tileY + 0.5;
  if (mode === 'iso') {
    centerOnTile(camera, cx, cy, viewWidth, viewHeight);
  } else {
    centerOn(camera, cx * TILE_SIZE, cy * TILE_SIZE, viewWidth, viewHeight);
  }
}
