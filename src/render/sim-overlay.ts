import type { Camera, NpcInstance, NpcSimState } from '@/core/types';
import { worldToScreen } from '@/render/camera';
import { TILE_SIZE } from '@/core/constants';
import type { OverlayHitArea } from '@/ui/overlay-dispatcher';

export type { OverlayHitArea };
export type OverlayHitAreas = OverlayHitArea[];

const BTN_W = 130;
const BTN_H = 22;
const BTN_GAP = 8;

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/**
 * Render the floating divine-action button anchored above the selected NPC.
 * Identity/needs/belief stats live in the DOM info panel (see `renderNpcInfoPanel`);
 * this overlay is only the action affordance plus its click hit area.
 */
export function drawNpcOverlay(
  ctx: CanvasRenderingContext2D,
  npc: NpcInstance,
  sim: NpcSimState,
  camera: Camera,
  canvasWidth: number,
  canvasHeight: number,
  playerPower: number,
): OverlayHitAreas {
  const { sx, sy } = worldToScreen(camera, npc.tileX, npc.tileY, TILE_SIZE);
  const tileScreenSize = TILE_SIZE * camera.zoom;

  let bx = sx + tileScreenSize / 2 - BTN_W / 2;
  let by = sy - BTN_H - BTN_GAP;
  bx = Math.max(4, Math.min(canvasWidth  - BTN_W - 4, bx));
  by = Math.max(4, Math.min(canvasHeight - BTN_H - 4, by));

  const whisperActive = playerPower >= 1 && sim.whisperCooldown === 0;

  ctx.save();
  roundRect(ctx, bx, by, BTN_W, BTN_H, 4);
  if (whisperActive) {
    ctx.fillStyle = '#B8860B';
    ctx.fill();
    ctx.strokeStyle = '#FFD700';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  } else {
    ctx.fillStyle = 'rgba(30,30,40,0.85)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(150,150,150,0.4)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  ctx.font = 'bold 10px sans-serif';
  ctx.fillStyle = whisperActive ? '#FFD700' : 'rgba(180,180,180,0.5)';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  const cooldownSuffix = sim.whisperCooldown > 0 ? ` (${sim.whisperCooldown}s)` : '';
  ctx.fillText(`🗣 Whisper (-1⚡)${cooldownSuffix}`, bx + BTN_W / 2, by + BTN_H / 2);
  ctx.restore();

  return [
    { x: bx, y: by, w: BTN_W, h: BTN_H, action: 'whisper', payload: { npcId: npc.id }, active: whisperActive },
  ];
}
