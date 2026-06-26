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
 *
 * Returns INTEGER tile indices in BOTH paths — `pickTile` answers "which tile is under the
 * cursor", and every consumer uses the result as a tile INDEX (`map.tiles[ty][tx]`,
 * `Math.floor(e.x) === tx` for selection, right-click placement, the dev hit-tester). The
 * lifted marcher resolves a sub-tile fractional position; we round it to the nearest tile
 * centre to match the flat inverse's `Math.round` convention. Callers that need the sub-tile
 * value (the connectome / studio overlay) call `screenToTileLifted` directly, not this wrapper.
 */
export function pickTile(camera: Camera, sx: number, sy: number, env?: IsoEnv | null): { tx: number; ty: number } {
  if (env) {
    const { tx, ty } = screenToTileLifted(sx, sy, camera, env);
    return { tx: Math.round(tx), ty: Math.round(ty) };
  }
  const worldSx = sx / camera.zoom + camera.x;
  const worldSy = sy / camera.zoom + camera.y;
  const { tx, ty } = isoScreenToTile(worldSx, worldSy, 0, 0);
  return { tx, ty };
}
