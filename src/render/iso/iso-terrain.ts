import type { GameMap, DevModeState } from '@/core/types';
import { TILE_COLORS } from '@/core/constants';
import { worldToScreen } from './iso-projection';
import { ISO_TILE_W, ISO_TILE_H } from './iso-constants';
import type { TileBounds } from './iso-projection';
import { effectiveTileType } from '@/render/layer-visibility';
import { getHeightfield } from '@/world/heightfield';
import { shadeHex, litTileColorHex, tileHash01 } from './terrain-shading';

// Re-exported for backwards compatibility (tests + callers import it here).
export { tileHash01 };

/**
 * Engine-drawn iso terrain tiles (our own tile renderer — a full terrain shader
 * comes later). Each tile is a diamond TOP with a short front SKIRT, so ground
 * reads as a slab with depth rather than a flat decal:
 *
 *   - **Per-tile value noise** — a deterministic ±NOISE_AMP lightness jitter
 *     hashed from (tx,ty) breaks the flat-poster look so adjacent same-type
 *     tiles read as discrete. Deterministic (no Math.random) like the tree
 *     scatter, so it's stable across frames/scrub.
 *   - **Front skirts** — the two front-facing edges (down-left SW, down-right
 *     SE) drop by ISO_SKIRT_H into darker side walls (left ×SKIRT_LEFT, right
 *     ×SKIRT_RIGHT) for an instant lit/3D read. Each skirt is drawn only where
 *     its front neighbour is ABSENT (the tile in front would occlude it anyway),
 *     so on a full map skirts show along the silhouette and around holes — the
 *     slab depth — for near-zero extra fill.
 *   - **Seam-proofing** — vertices snap to whole pixels and the diamond is
 *     inflated 1px so neighbours overlap (no 1px anti-alias gaps between tiles).
 *
 * Elevation (R1) — each diamond is SHADED by the world heightfield: ground above
 * the waterline lightens, ground below darkens, so relief reads at a glance.
 * Geometric per-tile z (lifting the diamond + entities together) is still out of
 * scope here — that arrives with the unified GPU scene (R2); `worldToScreen`
 * already takes a z param for it, and terrain stays at z=0 so it can't desync
 * from entities that still sit at z=0.
 */
export interface IsoTerrainArgs {
  map: GameMap;
  bounds: TileBounds;
  originX: number;
  originY: number;
  devMode?: DevModeState;
}

/** Vertical depth of the front skirt (px on a 64px-tall tile). */
export const ISO_SKIRT_H = 12;
/** Skirt darkening: left (SW) wall vs right (SE) wall — fakes directional light. */
const SKIRT_LEFT = 0.7;
const SKIRT_RIGHT = 0.55;

export function drawIsoTerrain(ctx: CanvasRenderingContext2D, args: IsoTerrainArgs): void {
  const { map, bounds, originX, originY, devMode } = args;
  ctx.imageSmoothingEnabled = false;
  const halfW = ISO_TILE_W / 2;
  const halfH = ISO_TILE_H / 2;

  // R1: the seed-deterministic world heightfield (memoised — recomputed once
  // per world, then O(1)). Indexed inline below so we touch the Float32Array
  // directly per tile rather than rebuilding a lookup key each cell.
  const heightfield = getHeightfield(map.seed, map.width, map.height);

  const iMin = bounds.minTx + bounds.minTy;
  const iMax = bounds.maxTx + bounds.maxTy;
  for (let i = iMin; i <= iMax; i++) {
    const txLo = Math.max(bounds.minTx, i - bounds.maxTy);
    const txHi = Math.min(bounds.maxTx, i - bounds.minTy);
    for (let tx = txLo; tx <= txHi; tx++) {
      const ty = i - tx;
      const tile = map.tiles[ty]?.[tx];
      if (!tile) continue;

      const { sx, sy } = worldToScreen(tx, ty, 0, originX, originY);
      const cx = Math.round(sx);
      const cy = Math.round(sy);
      // +1px overdraw → neighbouring diamonds overlap, killing anti-alias seams.
      const top = { x: cx, y: cy - halfH - 1 };
      const right = { x: cx + halfW + 1, y: cy };
      const bottom = { x: cx, y: cy + halfH + 1 };
      const left = { x: cx - halfW - 1, y: cy };

      const baseType = effectiveTileType(tile.type, devMode);
      const base = TILE_COLORS[baseType] ?? '#444';
      // Height + noise shading (shared with the GPU heightfield mesh — R2d).
      const elev = heightfield[ty * map.width + tx];
      const lit = litTileColorHex(base, elev, tx, ty);

      // Front skirts first (the top diamond is drawn after and meets them at the
      // front edges). Cull each where the tile in front of it exists — that tile
      // occludes the skirt, so we'd only be painting hidden pixels.
      if (!map.tiles[ty + 1]?.[tx]) {
        // left / south-west wall, under the W→S edge
        ctx.fillStyle = shadeHex(lit, SKIRT_LEFT);
        ctx.beginPath();
        ctx.moveTo(left.x, left.y);
        ctx.lineTo(bottom.x, bottom.y);
        ctx.lineTo(bottom.x, bottom.y + ISO_SKIRT_H);
        ctx.lineTo(left.x, left.y + ISO_SKIRT_H);
        ctx.closePath();
        ctx.fill();
      }
      if (!map.tiles[ty]?.[tx + 1]) {
        // right / south-east wall, under the S→E edge
        ctx.fillStyle = shadeHex(lit, SKIRT_RIGHT);
        ctx.beginPath();
        ctx.moveTo(bottom.x, bottom.y);
        ctx.lineTo(right.x, right.y);
        ctx.lineTo(right.x, right.y + ISO_SKIRT_H);
        ctx.lineTo(bottom.x, bottom.y + ISO_SKIRT_H);
        ctx.closePath();
        ctx.fill();
      }

      // Top diamond.
      ctx.fillStyle = lit;
      ctx.beginPath();
      ctx.moveTo(top.x, top.y);
      ctx.lineTo(right.x, right.y);
      ctx.lineTo(bottom.x, bottom.y);
      ctx.lineTo(left.x, left.y);
      ctx.closePath();
      ctx.fill();
    }
  }
}
