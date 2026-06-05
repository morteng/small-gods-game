import { ISO_TILE_W, ISO_TILE_H } from './iso-constants';
import { worldToScreen } from './iso-projection';
import type { IsoAtlas } from './iso-atlas';
import type { NpcInstance, Entity } from '@/core/types';
import { tryGetEntityKindDef } from '@/world/entity-kinds';
import { getSpriteCoords } from '@/render/npc-animator';

export interface IsoDrawCtx {
  ctx: CanvasRenderingContext2D;
  atlas: IsoAtlas;
  originX: number;
  originY: number;
  /** LPC spritesheets keyed by NPC id (shared with top-down renderer). */
  npcSheets?: Map<string, HTMLCanvasElement>;
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
export const BILLBOARD_H_PX = 64;

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

    // Shadow on ground
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(sx, sy, billboardW * 0.35, ISO_TILE_H * 0.22, 0, 0, Math.PI * 2);
    ctx.fill();

    // Sprite billboard
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(sheet, sheetSx, sheetSy, 64, 64,
                  sx - billboardW / 2, sy - billboardH, billboardW, billboardH);
    return;
  }

  // 3. Fallback colored circle (no art available)
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(sx, sy, ISO_TILE_W / 4, ISO_TILE_H / 4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = NPC_COLOR_BY_ROLE[npc.role] ?? NPC_COLOR_BY_ROLE.default;
  ctx.beginPath();
  ctx.arc(sx, sy - 16, 12, 0, Math.PI * 2);
  ctx.fill();
}

const TRUNK_COLOR = '#5a4030';

/**
 * Draw a vegetation entity as an iso primitive: ground shadow, an optional
 * trunk for tall trees, and a canopy whose shape/color come from the entity
 * kind catalog. `yOffsetForSort` doubles as a size class (0.1 ground cover →
 * 1.5 mature tree). No-op for non-vegetation kinds.
 */
export function drawIsoVegetation(dc: IsoDrawCtx, e: Entity): void {
  const def = tryGetEntityKindDef(e.kind);
  if (!def || def.category !== 'vegetation') return;

  const ctx = dc.ctx;
  const { sx, sy } = worldToScreen(e.x, e.y, 0, dc.originX, dc.originY);
  
  // Get scale from entity properties (set by brush), fallback to yOffsetForSort.
  // Vegetation is never rotated (tilted trees read as wrong) — variety comes
  // from scale and clumped placement instead.
  const scale = (e.properties?.scale as number) ?? Math.max(def.yOffsetForSort ?? 0.5, 0.5);

  // Trees have 'tree' in their defaultTags; ground cover (fern, shrub) does not
  const isTree = def.defaultTags.includes('tree');
  const canopyR = 10 + scale * 22;
  const trunkH = isTree ? 16 + scale * 24 : 0;

  ctx.save();
  ctx.translate(sx, sy);

  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(0, 0, canopyR * 0.8, canopyR * 0.4, 0, 0, Math.PI * 2);
  ctx.fill();

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
