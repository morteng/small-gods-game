import type { GameMap, DevModeState } from '@/core/types';
import { TILE_COLORS } from '@/core/constants';
import { worldToScreen } from './iso-projection';
import { ISO_TILE_W, ISO_TILE_H } from './iso-constants';
import type { TileBounds } from './iso-projection';
import { effectiveTileType } from '@/render/layer-visibility';

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
 * Elevation (per-tile z / taller skirts at shorelines) is intentionally out of
 * scope here; `worldToScreen` already takes a z param for that later step.
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
/** Per-tile lightness jitter amplitude (fraction of the base colour). */
const NOISE_AMP = 0.06;
/** Skirt darkening: left (SW) wall vs right (SE) wall — fakes directional light. */
const SKIRT_LEFT = 0.7;
const SKIRT_RIGHT = 0.55;

/**
 * Deterministic [0,1) hash of an integer tile coord. Mixes both axes through
 * `Math.imul` so neighbouring tiles decorrelate (the shared-LCG-step correlation
 * the tree scatter hit). No `Math.random` — stable per tile across frames.
 */
export function tileHash01(tx: number, ty: number): number {
  let h = Math.imul(tx | 0, 0x27d4eb2d) ^ Math.imul(ty | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h ^ (h >>> 13), 0x297a2d39);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Scale a #rrggbb colour by `f` (clamped to 0..255 per channel). */
function shade(hex: string, f: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = Math.min(255, Math.round(((n >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((n >> 8) & 255) * f));
  const b = Math.min(255, Math.round((n & 255) * f));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

export function drawIsoTerrain(ctx: CanvasRenderingContext2D, args: IsoTerrainArgs): void {
  const { map, bounds, originX, originY, devMode } = args;
  ctx.imageSmoothingEnabled = false;
  const halfW = ISO_TILE_W / 2;
  const halfH = ISO_TILE_H / 2;

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
      const lit = shade(base, 1 + (tileHash01(tx, ty) - 0.5) * 2 * NOISE_AMP);

      // Front skirts first (the top diamond is drawn after and meets them at the
      // front edges). Cull each where the tile in front of it exists — that tile
      // occludes the skirt, so we'd only be painting hidden pixels.
      if (!map.tiles[ty + 1]?.[tx]) {
        // left / south-west wall, under the W→S edge
        ctx.fillStyle = shade(lit, SKIRT_LEFT);
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
        ctx.fillStyle = shade(lit, SKIRT_RIGHT);
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
