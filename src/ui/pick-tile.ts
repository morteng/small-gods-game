// src/ui/pick-tile.ts
import type { Camera } from '@/core/types';
import { TILE_SIZE } from '@/core/constants';
import { screenToWorld } from '@/render/camera';
import { screenToTile as isoScreenToTile } from '@/render/iso/iso-projection';
import { readRenderMode } from '@/render/select-renderer';

export function pickTile(camera: Camera, sx: number, sy: number): { tx: number; ty: number } {
  // Only the legacy top-down renderer uses the flat grid mapping. The GPU
  // renderer is iso-projected (same draw list as the iso path), so it shares the
  // iso picking math — anything that isn't 'topdown' picks via iso.
  if (readRenderMode() !== 'topdown') {
    const worldSx = sx / camera.zoom + camera.x;
    const worldSy = sy / camera.zoom + camera.y;
    const { tx, ty } = isoScreenToTile(worldSx, worldSy, 0, 0);
    return { tx, ty };
  }
  const { wx, wy } = screenToWorld(camera, sx, sy, TILE_SIZE);
  return { tx: wx, ty: wy };
}
