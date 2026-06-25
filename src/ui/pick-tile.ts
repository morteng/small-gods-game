// src/ui/pick-tile.ts
import type { Camera } from '@/core/types';
import { screenToTile as isoScreenToTile } from '@/render/iso/iso-projection';
import { screenToTile as screenToTileLifted, type IsoEnv } from '@/render/iso/lifted-projection';

/**
 * Screen (canvas) → tile. The renderer is iso-projected, so picking is the inverse iso
 * transform. When an `env` (the world's terrain sampler + lift constants — build it with
 * `isoEnvForMap`) is supplied, picking is LIFT-AWARE: it marches the view diagonal and
 * returns the frontmost tile actually drawn under the cursor, so clicking a hillside hits
 * the tile you see, not its sea-level shadow (the flat inverse is off by `liftPx /
 * ISO_HALF_H` tiles — several tiles on a tall peak). Without `env` it falls back to the
 * flat, height-free inverse (correct on flat ground; the legacy behaviour).
 */
export function pickTile(camera: Camera, sx: number, sy: number, env?: IsoEnv | null): { tx: number; ty: number } {
  if (env) return screenToTileLifted(sx, sy, camera, env);
  const worldSx = sx / camera.zoom + camera.x;
  const worldSy = sy / camera.zoom + camera.y;
  const { tx, ty } = isoScreenToTile(worldSx, worldSy, 0, 0);
  return { tx, ty };
}
