import type { Camera, NpcInstance, NpcSimState } from '@/core/types';
import { worldToScreen } from '@/render/camera';
import { TILE_SIZE } from '@/core/constants';
import { CANVAS, CANVAS_FONT } from '@/render/canvas-palette';
import type { OverlayHitArea } from '@/ui/overlay-dispatcher';
import { queryNpcs, npcProps } from '@/world/npc-helpers';
import type { World } from '@/world/world';

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
    ctx.fillStyle = CANVAS.whisperFill;
    ctx.fill();
    ctx.strokeStyle = CANVAS.whisperLine;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  } else {
    ctx.fillStyle = CANVAS.inactiveFill;
    ctx.fill();
    ctx.strokeStyle = CANVAS.inactiveLine;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  ctx.font = CANVAS_FONT.buttonSmall;
  ctx.fillStyle = whisperActive ? CANVAS.onAction : CANVAS.inactiveText;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  const cooldownSuffix = sim.whisperCooldown > 0 ? ` (${sim.whisperCooldown}s)` : '';
  ctx.fillText(`🗣 Whisper (-1⚡)${cooldownSuffix}`, bx + BTN_W / 2, by + BTN_H / 2);
  ctx.restore();

  return [
    { x: bx, y: by, w: BTN_W, h: BTN_H, action: 'whisper', payload: { npcId: npc.id }, active: whisperActive },
  ];
}

// ─── Settlement overlay (right-click on POI) ──────────────────────

export function drawPoiOverlay(
  ctx: CanvasRenderingContext2D,
  poiId: string,
  px: number,
  py: number,
  camera: Camera,
  canvasWidth: number,
  canvasHeight: number,
  playerPower: number,
): OverlayHitAreas {
  const { sx, sy } = worldToScreen(camera, px, py, TILE_SIZE);
  const tileScreenSize = TILE_SIZE * camera.zoom;

  const totalH = BTN_H * 2 + BTN_GAP;
  let bx = sx + tileScreenSize / 2 - BTN_W / 2;
  let by = sy - totalH - BTN_GAP;
  bx = Math.max(4, Math.min(canvasWidth  - BTN_W - 4, bx));
  by = Math.max(4, Math.min(canvasHeight - totalH - 4, by));

  const omenActive = playerPower >= 3;
  const miracleActive = playerPower >= 10;

  const areas: OverlayHitAreas = [];

  // Omen button
  ctx.save();
  roundRect(ctx, bx, by, BTN_W, BTN_H, 4);
  if (omenActive) {
    ctx.fillStyle = CANVAS.omenFill;
    ctx.fill();
    ctx.strokeStyle = CANVAS.omenLine;
  } else {
    ctx.fillStyle = CANVAS.inactiveFill;
    ctx.fill();
    ctx.strokeStyle = CANVAS.inactiveLine;
  }
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.font = CANVAS_FONT.buttonSmall;
  ctx.fillStyle = omenActive ? CANVAS.onAction : CANVAS.inactiveText;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText(`⛈ Omen (-3⚡)`, bx + BTN_W / 2, by + BTN_H / 2);
  ctx.restore();
  areas.push({ x: bx, y: by, w: BTN_W, h: BTN_H, action: 'omen', payload: { poiId }, active: omenActive });

  // Miracle button
  ctx.save();
  roundRect(ctx, bx, by + BTN_H + BTN_GAP, BTN_W, BTN_H, 4);
  if (miracleActive) {
    ctx.fillStyle = CANVAS.miracleFill;
    ctx.fill();
    ctx.strokeStyle = CANVAS.miracleLine;
  } else {
    ctx.fillStyle = CANVAS.inactiveFill;
    ctx.fill();
    ctx.strokeStyle = CANVAS.inactiveLine;
  }
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.font = CANVAS_FONT.buttonSmall;
  ctx.fillStyle = miracleActive ? CANVAS.onAction : CANVAS.inactiveText;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText(`✨ Miracle (-10⚡)`, bx + BTN_W / 2, by + BTN_H + BTN_GAP + BTN_H / 2);
  ctx.restore();
  areas.push({ x: bx, y: by + BTN_H + BTN_GAP, w: BTN_W, h: BTN_H, action: 'miracle', payload: { poiId }, active: miracleActive });

  return areas;
}

/** Draw a 🙏 over every NPC currently in `worship`, so the player can see who
 *  needs them at a glance. Independent of selection. */
export function drawPrayerMarkers(
  ctx: CanvasRenderingContext2D,
  world: World,
  camera: Camera,
): void {
  ctx.save();
  ctx.font = '16px serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  const tileScreenSize = TILE_SIZE * camera.zoom;
  for (const e of queryNpcs(world)) {
    if (npcProps(e).activity !== 'worship') continue;
    const { sx, sy } = worldToScreen(camera, e.x, e.y, TILE_SIZE);
    ctx.fillText('🙏', sx + tileScreenSize / 2, sy - 2);
  }
  ctx.restore();
}
