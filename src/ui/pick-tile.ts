// src/ui/pick-tile.ts
import type { Camera } from '@/core/types';
import { screenToTile as isoScreenToTile } from '@/render/iso/iso-projection';

/** Screen (canvas) → tile. The renderer is iso-projected, so picking is the
 *  inverse iso transform. (The legacy topdown grid mapping died with the
 *  WebGPU-only cut.) */
export function pickTile(camera: Camera, sx: number, sy: number): { tx: number; ty: number } {
  const worldSx = sx / camera.zoom + camera.x;
  const worldSy = sy / camera.zoom + camera.y;
  const { tx, ty } = isoScreenToTile(worldSx, worldSy, 0, 0);
  return { tx, ty };
}
