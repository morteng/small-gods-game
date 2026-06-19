import type { Camera, GameMap } from '@/core/types';
import { centerOnTile } from './iso/iso-camera';
import { tileLiftPx } from '@/render/gpu/terrain-lift';
import { terrainLiftFieldFor } from '@/render/gpu/terrain-field';

/**
 * Center the camera on a tile, zoom-aware. The renderer is iso-projected, so
 * `camera.x/y` live in iso screen space — centering routes through the iso
 * helper. (The old topdown branch died with the WebGPU-only cut.)
 *
 * `+0.5` targets the tile's center rather than its top/left corner.
 *
 * Pass `map` so high ground frames at its LIFTED screen position — without it,
 * the GPU shader pushes hilltops up-screen out of a sea-level-centred frame (the
 * long-standing "focus lands on water / roads shoved behind hills" bug). The
 * height buffer is memoised, so building the lift field per focus is cheap.
 * Omitting `map` keeps the flat (sea-level) behaviour.
 */
export function focusCameraOnTile(
  camera: Camera,
  tileX: number,
  tileY: number,
  viewWidth: number,
  viewHeight: number,
  map?: GameMap | null,
): void {
  const lift = map ? tileLiftPx(terrainLiftFieldFor(map), tileX + 0.5, tileY + 0.5) : 0;
  centerOnTile(camera, tileX + 0.5, tileY + 0.5, viewWidth, viewHeight, lift);
}
