import { ISO_TILE_W, ISO_TILE_H } from './iso-constants';
import { worldToScreen } from './iso-projection';
import type { IsoAtlas } from './iso-atlas';
import type { NpcInstance, BuildingInstance, Entity } from '@/core/types';
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
 */
const BILLBOARD_H_PX = 64;

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

export function drawIsoBuilding(
  dc: IsoDrawCtx,
  b: BuildingInstance,
  footprintW: number,
  footprintH: number,
): void {
  const sprite = dc.atlas.getBuilding(b.templateId);
  if (sprite) return;
  const ctx = dc.ctx;
  const baseHeight = 40;
  const frontX = b.tileX + footprintW - 1;
  const frontY = b.tileY + footprintH - 1;
  const backX  = b.tileX;
  const backY  = b.tileY;
  const front = worldToScreen(frontX, frontY, 0, dc.originX, dc.originY);
  const back  = worldToScreen(backX,  backY,  0, dc.originX, dc.originY);
  const east  = worldToScreen(frontX, backY,  0, dc.originX, dc.originY);
  const west  = worldToScreen(backX,  frontY, 0, dc.originX, dc.originY);
  // flat top (roof)
  ctx.fillStyle = '#7a5a3f';
  ctx.beginPath();
  ctx.moveTo(back.sx, back.sy);
  ctx.lineTo(east.sx, east.sy);
  ctx.lineTo(front.sx, front.sy);
  ctx.lineTo(west.sx, west.sy);
  ctx.closePath();
  ctx.fill();
  // top face (raised)
  ctx.fillStyle = '#a07a55';
  ctx.beginPath();
  ctx.moveTo(back.sx, back.sy - baseHeight);
  ctx.lineTo(east.sx, east.sy - baseHeight);
  ctx.lineTo(front.sx, front.sy - baseHeight);
  ctx.lineTo(west.sx, west.sy - baseHeight);
  ctx.closePath();
  ctx.fill();
  // east side face
  ctx.fillStyle = '#5d4530';
  ctx.beginPath();
  ctx.moveTo(east.sx, east.sy);
  ctx.lineTo(front.sx, front.sy);
  ctx.lineTo(front.sx, front.sy - baseHeight);
  ctx.lineTo(east.sx, east.sy - baseHeight);
  ctx.closePath();
  ctx.fill();
  // west side face
  ctx.fillStyle = '#4a3624';
  ctx.beginPath();
  ctx.moveTo(west.sx, west.sy);
  ctx.lineTo(front.sx, front.sy);
  ctx.lineTo(front.sx, front.sy - baseHeight);
  ctx.lineTo(west.sx, west.sy - baseHeight);
  ctx.closePath();
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
  const size = def.yOffsetForSort ?? 0.5;
  const isTree = size >= 1;
  const canopyR = 10 + size * 22;
  const trunkH = isTree ? 16 + size * 24 : 0;

  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(sx, sy, canopyR * 0.8, canopyR * 0.4, 0, 0, Math.PI * 2);
  ctx.fill();

  if (isTree) {
    ctx.fillStyle = TRUNK_COLOR;
    ctx.fillRect(sx - 2, sy - trunkH, 4, trunkH);
  }

  const cy = sy - trunkH - (isTree ? 0 : canopyR * 0.3);
  ctx.fillStyle = def.sprite.fallbackColor ?? '#3a7a3a';
  ctx.beginPath();
  if (def.sprite.fallbackShape === 'triangle') {
    ctx.moveTo(sx, cy - canopyR * 1.6);
    ctx.lineTo(sx + canopyR, cy + canopyR * 0.4);
    ctx.lineTo(sx - canopyR, cy + canopyR * 0.4);
    ctx.closePath();
  } else if (def.sprite.fallbackShape === 'square') {
    ctx.rect(sx - canopyR, cy - canopyR, canopyR * 2, canopyR * 2);
  } else {
    ctx.arc(sx, cy, canopyR, 0, Math.PI * 2);
  }
  ctx.fill();
}
