import { ISO_TILE_W, ISO_TILE_H } from './iso-constants';
import { worldToScreen } from './iso-projection';
import type { IsoAtlas } from './iso-atlas';
import type { NpcInstance, Entity } from '@/core/types';
import { tryGetEntityKindDef } from '@/world/entity-kinds';
import { getSpriteCoords } from '@/render/npc-animator';
import { treeSheetForKind, treeSpriteColumn, TREE_SPRITE_SRC } from '@/render/tree-sheets';
import { HUMAN_PX, NATURE_HEIGHT_M, DEFAULT_NATURE_HEIGHT_M, mToPx } from '@/render/scale-contract';

export interface IsoDrawCtx {
  ctx: CanvasRenderingContext2D;
  atlas: IsoAtlas;
  originX: number;
  originY: number;
  /** LPC spritesheets keyed by NPC id (shared with top-down renderer). */
  npcSheets?: Map<string, HTMLCanvasElement>;
  /** Tree sheets keyed by variant (green/orange/…), shared with top-down. */
  treeSheets?: Map<string, HTMLImageElement>;
}

/**
 * Billboard target height (px) and the nearest INTEGER source-scale class for a nature
 * kind, given a per-instance variety multiplier (~0.85..1.15; defaults to 1). Integer
 * scale keeps the blit pixel-crisp (1:1 rule).
 * NOTE: source art is TREE_SPRITE_SRC px; a truthful tall tree is a large integer upscale
 * (blocky) until art is re-authored at native sizes (period/style track).
 */
export function natureBillboard(kind: string, variety = 1): { targetPx: number; srcScale: number } {
  const m = (NATURE_HEIGHT_M[kind] ?? DEFAULT_NATURE_HEIGHT_M) * variety;
  const targetPx = mToPx(m);
  const srcScale = Math.max(1, Math.round(targetPx / TREE_SPRITE_SRC));
  return { targetPx, srcScale };
}

const NPC_COLOR_BY_ROLE: Record<string, string> = {
  villager: '#d4a574',
  priest:   '#cdb5ff',
  default:  '#e0e0e0',
};

/**
 * Pixel height of the LPC sprite billboard above the ground.
 * Must match the z-offset in worldToScreen (z is in raw screen pixels).
 * Exported so overlay markers (e.g. the prayer 🙏) can sit just above the head.
 */
/** Billboard z-height for an NPC = the metric human visible height (snapped px). */
export const BILLBOARD_H_PX = HUMAN_PX;     // 54

export function drawIsoNpc(dc: IsoDrawCtx, npc: NpcInstance): void {
  const { sx, sy } = worldToScreen(npc.tileX, npc.tileY, 0, dc.originX, dc.originY);
  const ctx = dc.ctx;

  // 1. Iso character atlas (future PR 4) — not available yet
  const isoSprite = dc.atlas.getCharacter(npc.role);
  if (isoSprite) {
    return;
  }

  // 2. Billboard from LPC spritesheet (reuse top-down art)
  const sheet = dc.npcSheets?.get(npc.id);
  if (sheet) {
    const { sx: sheetSx, sy: sheetSy } = getSpriteCoords(npc);
    const top = worldToScreen(npc.tileX, npc.tileY, BILLBOARD_H_PX, dc.originX, dc.originY);
    const billboardH = sy - top.sy;
    const billboardW = billboardH; // square sprite

    // Sprite billboard
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(sheet, sheetSx, sheetSy, 64, 64,
                  sx - billboardW / 2, sy - billboardH, billboardW, billboardH);
    return;
  }

  // 3. Fallback colored circle (no art available)
  ctx.fillStyle = NPC_COLOR_BY_ROLE[npc.role] ?? NPC_COLOR_BY_ROLE.default;
  ctx.beginPath();
  ctx.arc(sx, sy - 16, 12, 0, Math.PI * 2);
  ctx.fill();
}

/** Draw a square art sprite (decoration or prop) as an upright billboard,
 *  base anchored at the tile center. */
export function drawIsoArtBillboard(
  dc: IsoDrawCtx, img: HTMLImageElement, tx: number, ty: number,
): void {
  const { ctx, originX, originY } = dc;
  const { sx, sy } = worldToScreen(tx, ty, 0, originX, originY);
  // WYSIWYG: blit at the art's NATIVE pixel size (never tile-fraction scaled) so
  // one source pixel == one screen pixel at zoom 1. Base anchored at tile centre.
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  ctx.save();
  ctx.translate(Math.round(sx), Math.round(sy));
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, -Math.round(w / 2), -h, w, h);
  ctx.restore();
}

const TRUNK_COLOR = '#5a4030';

/**
 * Draw a vegetation entity as an iso primitive: an optional
 * trunk for tall trees, and a canopy whose shape/color come from the entity
 * kind catalog. `yOffsetForSort` doubles as a size class (0.1 ground cover →
 * 1.5 mature tree). No-op for non-vegetation kinds.
 */
export function drawIsoVegetation(dc: IsoDrawCtx, e: Entity): void {
  const def = tryGetEntityKindDef(e.kind);
  if (!def || def.category !== 'vegetation') return;

  const ctx = dc.ctx;
  const { sx, sy } = worldToScreen(e.x, e.y, 0, dc.originX, dc.originY);

  // `scale` is now a per-instance VARIETY multiplier (~0.85..1.15), not an absolute size.
  // Vegetation is never rotated (tilted trees read as wrong) — variety comes
  // from the multiplier and clumped placement instead.
  const variety = (e.properties?.scale as number) ?? 1;
  const { targetPx, srcScale } = natureBillboard(e.kind, variety);

  // Prefer the real tree sprite (same sheets as the top-down renderer),
  // billboarded upright like NPCs. Falls back to the drawn placeholder below
  // when no sheet is loaded (headless/tests) or for sheet-less ground cover.
  const sheetName = treeSheetForKind(e.kind);
  const sheet = sheetName ? dc.treeSheets?.get(sheetName) : undefined;
  if (sheet) {
    // WYSIWYG native-blit at an INTEGER pixel-scale class (1× small, 2× mature) —
    // never a fractional scale, so the tree stays pixel-perfect. The 1.5-aspect
    // stretch is gone (it distorted the square source); clump variety now comes
    // from the size class + placement. (Tree art will be re-authored at true sizes
    // in a later pass; until then a square 64/128px billboard is the 1:1 form.)
    const treeW = TREE_SPRITE_SRC * srcScale;
    const treeH = TREE_SPRITE_SRC * srcScale;
    const col = treeSpriteColumn(Math.floor(e.x), Math.floor(e.y));
    ctx.save();
    ctx.translate(Math.round(sx), Math.round(sy)); // integer position → crisp blit
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(sheet, col * TREE_SPRITE_SRC, 0, TREE_SPRITE_SRC, TREE_SPRITE_SRC,
                  -treeW / 2, -treeH, treeW, treeH);
    ctx.restore();
    return;
  }

  // Trees have 'tree' in their defaultTags; ground cover (fern, shrub) does not
  const isTree = def.defaultTags.includes('tree');
  const canopyR = isTree ? targetPx * 0.35 : targetPx * 0.5;
  const trunkH = isTree ? targetPx * 0.55 : 0;

  ctx.save();
  ctx.translate(sx, sy);

  if (isTree) {
    ctx.fillStyle = TRUNK_COLOR;
    ctx.fillRect(-2, -trunkH, 4, trunkH);
  }

  const cy = -trunkH - (isTree ? 0 : canopyR * 0.3);
  ctx.fillStyle = def.sprite.fallbackColor ?? '#3a7a3a';
  ctx.beginPath();
  if (def.sprite.fallbackShape === 'triangle') {
    ctx.moveTo(0, cy - canopyR * 1.6);
    ctx.lineTo(canopyR, cy + canopyR * 0.4);
    ctx.lineTo(-canopyR, cy + canopyR * 0.4);
    ctx.closePath();
  } else if (def.sprite.fallbackShape === 'square') {
    ctx.rect(-canopyR, cy - canopyR, canopyR * 2, canopyR * 2);
  } else {
    ctx.arc(0, cy, canopyR, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.restore();
}
