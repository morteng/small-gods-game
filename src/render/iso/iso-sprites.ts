import { worldToScreen } from './iso-projection';
import type { IsoAtlas } from './iso-atlas';
import type { NpcInstance, Entity } from '@/core/types';
import { tryGetEntityKindDef } from '@/world/entity-kinds';
import { getSpriteCoords } from '@/render/npc-animator';
import { treeSheetForKind, treeSpriteColumn, TREE_SPRITE_SRC } from '@/render/tree-sheets';
import { NATURE_HEIGHT_M, DEFAULT_NATURE_HEIGHT_M, mToPx } from '@/render/scale-contract';
import { npcBillboard } from './npc-billboard';
import { executeDrawListCanvas, type DrawItem } from './draw-list';

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

/** The emitters need everything the draw ctx carries except the 2D context. */
export type IsoItemCtx = Omit<IsoDrawCtx, 'ctx'>;

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
 * Default pixel height of an NPC's visible body above the ground (head z for
 * overlay markers, e.g. the prayer 🙏). The OPAQUE BODY (not the 64px LPC
 * frame — the body only fills ~30px of it) anchors to HUMAN_PX via a nearest-
 * integer scale (1:1 rule), so this is body-height × scale, not HUMAN_PX itself.
 */
const DEFAULT_BB = npcBillboard(undefined);
export const BILLBOARD_H_PX = (DEFAULT_BB.bottom - DEFAULT_BB.top) * DEFAULT_BB.scale; // 30 at the interim 1× scale

const LPC_FRAME = 64;

export function npcItems(ic: IsoItemCtx, npc: NpcInstance): DrawItem[] {
  const { sx, sy } = worldToScreen(npc.tileX, npc.tileY, 0, ic.originX, ic.originY);

  // 1. Iso character atlas (future PR 4) — not available yet
  const isoSprite = ic.atlas.getCharacter(npc.role);
  if (isoSprite) {
    return [];
  }

  // 2. Billboard from LPC spritesheet (reuse top-down art)
  const sheet = ic.npcSheets?.get(npc.id);
  if (sheet) {
    const { sx: sheetSx, sy: sheetSy } = getSpriteCoords(npc);
    const bb = npcBillboard(sheet);
    const s = bb.scale;
    const drawW = LPC_FRAME * s, drawH = LPC_FRAME * s;

    // Feet (opaque bbox bottom) land on the tile point; whole frame at integer scale.
    return [{
      t: 'image', src: sheet,
      frame: { sx: sheetSx, sy: sheetSy, sw: LPC_FRAME, sh: LPC_FRAME },
      dx: Math.round(sx - drawW / 2), dy: Math.round(sy - bb.bottom * s),
      dw: drawW, dh: drawH,
    }];
  }

  // 3. Fallback colored circle (no art available)
  return [{
    t: 'circle', cx: sx, cy: sy - 16, r: 12,
    color: NPC_COLOR_BY_ROLE[npc.role] ?? NPC_COLOR_BY_ROLE.default,
  }];
}

export function drawIsoNpc(dc: IsoDrawCtx, npc: NpcInstance): void {
  executeDrawListCanvas(dc.ctx, npcItems(dc, npc));
}

/** A square art sprite (decoration or prop) as an upright billboard,
 *  base anchored at the tile center. */
export function artBillboardItem(
  o: { originX: number; originY: number }, img: HTMLImageElement, tx: number, ty: number,
): DrawItem {
  const { sx, sy } = worldToScreen(tx, ty, 0, o.originX, o.originY);
  // WYSIWYG: blit at the art's NATIVE pixel size (never tile-fraction scaled) so
  // one source pixel == one screen pixel at zoom 1. Base anchored at tile centre.
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  return {
    t: 'image', src: img,
    dx: Math.round(sx) - Math.round(w / 2), dy: Math.round(sy) - h,
    dw: w, dh: h,
  };
}

export function drawIsoArtBillboard(
  dc: IsoDrawCtx, img: HTMLImageElement, tx: number, ty: number,
): void {
  executeDrawListCanvas(dc.ctx, [artBillboardItem(dc, img, tx, ty)]);
}

const TRUNK_COLOR = '#5a4030';

/**
 * A vegetation entity as iso items: an optional trunk for tall trees, and a
 * canopy whose shape/color come from the entity kind catalog. `yOffsetForSort`
 * doubles as a size class (0.1 ground cover → 1.5 mature tree). Empty for
 * non-vegetation kinds.
 */
export function vegetationItems(ic: IsoItemCtx, e: Entity): DrawItem[] {
  const def = tryGetEntityKindDef(e.kind);
  if (!def || def.category !== 'vegetation') return [];

  const { sx, sy } = worldToScreen(e.x, e.y, 0, ic.originX, ic.originY);

  // `scale` is now a per-instance VARIETY multiplier (~0.85..1.15), not an absolute size.
  // Vegetation is never rotated (tilted trees read as wrong) — variety comes
  // from the multiplier and clumped placement instead.
  const variety = (e.properties?.scale as number) ?? 1;
  const { targetPx, srcScale } = natureBillboard(e.kind, variety);

  // Prefer the real tree sprite (same sheets as the top-down renderer),
  // billboarded upright like NPCs. Falls back to the drawn placeholder below
  // when no sheet is loaded (headless/tests) or for sheet-less ground cover.
  const sheetName = treeSheetForKind(e.kind);
  const sheet = sheetName ? ic.treeSheets?.get(sheetName) : undefined;
  if (sheet) {
    // WYSIWYG native-blit at an INTEGER pixel-scale class (1× small, 2× mature) —
    // never a fractional scale, so the tree stays pixel-perfect. The 1.5-aspect
    // stretch is gone (it distorted the square source); clump variety now comes
    // from the size class + placement. (Tree art will be re-authored at true sizes
    // in a later pass; until then a square 64/128px billboard is the 1:1 form.)
    const treeW = TREE_SPRITE_SRC * srcScale;
    const treeH = TREE_SPRITE_SRC * srcScale;
    const col = treeSpriteColumn(Math.floor(e.x), Math.floor(e.y));
    return [{
      t: 'image', src: sheet,
      frame: { sx: col * TREE_SPRITE_SRC, sy: 0, sw: TREE_SPRITE_SRC, sh: TREE_SPRITE_SRC },
      // integer position → crisp blit
      dx: Math.round(sx) - treeW / 2, dy: Math.round(sy) - treeH,
      dw: treeW, dh: treeH,
    }];
  }

  const items: DrawItem[] = [];
  // Trees have 'tree' in their defaultTags; ground cover (fern, shrub) does not
  const isTree = def.defaultTags.includes('tree');
  const canopyR = isTree ? targetPx * 0.35 : targetPx * 0.5;
  const trunkH = isTree ? targetPx * 0.55 : 0;

  if (isTree) {
    items.push({
      t: 'poly', color: TRUNK_COLOR,
      points: [
        { x: sx - 2, y: sy - trunkH }, { x: sx + 2, y: sy - trunkH },
        { x: sx + 2, y: sy }, { x: sx - 2, y: sy },
      ],
    });
  }

  const cy = sy - trunkH - (isTree ? 0 : canopyR * 0.3);
  const color = def.sprite.fallbackColor ?? '#3a7a3a';
  if (def.sprite.fallbackShape === 'triangle') {
    items.push({
      t: 'poly', color,
      points: [
        { x: sx, y: cy - canopyR * 1.6 },
        { x: sx + canopyR, y: cy + canopyR * 0.4 },
        { x: sx - canopyR, y: cy + canopyR * 0.4 },
      ],
    });
  } else if (def.sprite.fallbackShape === 'square') {
    items.push({
      t: 'poly', color,
      points: [
        { x: sx - canopyR, y: cy - canopyR }, { x: sx + canopyR, y: cy - canopyR },
        { x: sx + canopyR, y: cy + canopyR }, { x: sx - canopyR, y: cy + canopyR },
      ],
    });
  } else {
    items.push({ t: 'circle', cx: sx, cy, r: canopyR, color });
  }
  return items;
}

export function drawIsoVegetation(dc: IsoDrawCtx, e: Entity): void {
  executeDrawListCanvas(dc.ctx, vegetationItems(dc, e));
}
