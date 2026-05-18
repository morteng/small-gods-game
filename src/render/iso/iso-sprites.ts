import { ISO_TILE_W, ISO_TILE_H } from './iso-constants';
import { worldToScreen } from './iso-projection';
import type { IsoAtlas } from './iso-atlas';
import type { NpcInstance, BuildingInstance } from '@/core/types';

export interface IsoDrawCtx {
  ctx: CanvasRenderingContext2D;
  atlas: IsoAtlas;
  originX: number;
  originY: number;
}

const NPC_COLOR_BY_ROLE: Record<string, string> = {
  villager: '#d4a574',
  priest:   '#cdb5ff',
  default:  '#e0e0e0',
};

export function drawIsoNpc(dc: IsoDrawCtx, npc: NpcInstance): void {
  const { sx, sy } = worldToScreen(npc.tileX, npc.tileY, 0, dc.originX, dc.originY);
  const sheet = dc.atlas.getCharacter(npc.role);
  if (sheet) {
    return;
  }
  const ctx = dc.ctx;
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

export function drawIsoTree(dc: IsoDrawCtx, tx: number, ty: number, color: string): void {
  const sprite = dc.atlas.getTree(color);
  if (sprite) return;
  const { sx, sy } = worldToScreen(tx, ty, 0, dc.originX, dc.originY);
  const ctx = dc.ctx;
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(sx, sy, ISO_TILE_W / 5, ISO_TILE_H / 5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(sx, sy - 48);
  ctx.lineTo(sx + 16, sy - 4);
  ctx.lineTo(sx - 16, sy - 4);
  ctx.closePath();
  ctx.fill();
}
