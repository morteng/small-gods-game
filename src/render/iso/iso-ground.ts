/**
 * Draws the building ground-material field (foundation + apron) in iso, as
 * tinted diamonds sitting on the terrain beneath the building massing — the iso
 * counterpart to the top-down overlay in renderer.ts. Render-only and derived
 * per frame from the buildings' descriptors (see ground-material.ts), so it
 * reverts for free when a building moves or is deleted.
 */
import { worldToScreen } from './iso-projection';
import type { TileBounds } from './iso-projection';
import { computeGroundMaterialField } from '@/render/ground-material';
import { GROUND_COLORS, NEUTRAL } from '@/blueprint/materials';
import type { World } from '@/world/world';

/** Translucent so the underlying terrain tint still reads through, matching the
 *  top-down apron's blended look. */
const GROUND_ALPHA = 0.7;

export function drawIsoGroundField(
  ctx: CanvasRenderingContext2D,
  world: World,
  originX: number,
  originY: number,
  bounds: TileBounds,
): void {
  const field = computeGroundMaterialField(world);
  if (field.size === 0) return;

  ctx.save();
  ctx.globalAlpha = GROUND_ALPHA;
  for (const [k, mat] of field) {
    const comma = k.indexOf(',');
    const tx = Number(k.slice(0, comma));
    const ty = Number(k.slice(comma + 1));
    if (tx < bounds.minTx || tx > bounds.maxTx || ty < bounds.minTy || ty > bounds.maxTy) continue;

    const n = worldToScreen(tx, ty, 0, originX, originY);
    const e = worldToScreen(tx + 1, ty, 0, originX, originY);
    const s = worldToScreen(tx + 1, ty + 1, 0, originX, originY);
    const w = worldToScreen(tx, ty + 1, 0, originX, originY);

    ctx.fillStyle = GROUND_COLORS[mat] ?? NEUTRAL;
    ctx.beginPath();
    ctx.moveTo(n.sx, n.sy);
    ctx.lineTo(e.sx, e.sy);
    ctx.lineTo(s.sx, s.sy);
    ctx.lineTo(w.sx, w.sy);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}
