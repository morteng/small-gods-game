import type { Camera, NpcInstance, NpcSimState } from '@/core/types';
import { worldToScreen } from '@/render/camera';
import { TILE_SIZE } from '@/core/constants';

const CARD_W = 200;
const CARD_H = 195;
const CARD_PAD = 10;
const BAR_H = 10;
const BAR_W = CARD_W - CARD_PAD * 2 - 50;

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

function moodColor(mood: number): string {
  if (mood > 0.6) return '#4CAF50';
  if (mood > 0.3) return '#FFC107';
  return '#F44336';
}

function drawBar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  label: string,
  value: number,
  color: string,
): void {
  ctx.font = '9px monospace';
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.fillText(label, x, y + BAR_H - 1);

  const bx = x + 50;
  // Background track
  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  ctx.fillRect(bx, y, BAR_W, BAR_H);
  // Filled portion
  ctx.fillStyle = color;
  ctx.fillRect(bx, y, Math.max(0, value * BAR_W), BAR_H);
}

export function drawNpcOverlay(
  ctx: CanvasRenderingContext2D,
  npc: NpcInstance,
  sim: NpcSimState,
  camera: Camera,
  canvasWidth: number,
  canvasHeight: number,
): void {
  // Position card near the NPC tile (above it)
  const { sx, sy } = worldToScreen(camera, npc.tileX, npc.tileY, TILE_SIZE);
  const tileScreenSize = TILE_SIZE * camera.zoom;

  let cx = sx + tileScreenSize / 2 - CARD_W / 2;
  let cy = sy - CARD_H - 8;

  // Clamp to viewport
  cx = Math.max(4, Math.min(canvasWidth  - CARD_W - 4, cx));
  cy = Math.max(4, Math.min(canvasHeight - CARD_H - 4, cy));

  ctx.save();

  // Card background
  roundRect(ctx, cx, cy, CARD_W, CARD_H, 6);
  ctx.fillStyle = 'rgba(10, 10, 20, 0.88)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.2)';
  ctx.lineWidth = 1;
  ctx.stroke();

  let row = cy + CARD_PAD + 12;

  // Name + role header
  ctx.font = 'bold 11px sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(sim.name, cx + CARD_PAD, row);
  ctx.font = '9px sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.fillText(sim.role, cx + CARD_W - CARD_PAD - ctx.measureText(sim.role).width, row);

  row += 6;

  // Mood line
  row += 14;
  const moodPct = Math.round(sim.mood * 100);
  ctx.font = '10px sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.fillText('Mood', cx + CARD_PAD, row);
  ctx.fillStyle = moodColor(sim.mood);
  ctx.fillText(`${moodPct}%`, cx + CARD_PAD + 38, row);

  // Separator
  row += 6;
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx + CARD_PAD, row);
  ctx.lineTo(cx + CARD_W - CARD_PAD, row);
  ctx.stroke();

  // Needs section label
  row += 12;
  ctx.font = '9px sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.fillText('NEEDS', cx + CARD_PAD, row);

  row += 4;
  const bx = cx + CARD_PAD;
  drawBar(ctx, bx, row,      'Safety',   sim.needs.safety,     '#4CAF50');
  row += BAR_H + 3;
  drawBar(ctx, bx, row,      'Prosprt',  sim.needs.prosperity, '#FFC107');
  row += BAR_H + 3;
  drawBar(ctx, bx, row,      'Commty',   sim.needs.community,  '#42A5F5');
  row += BAR_H + 3;
  drawBar(ctx, bx, row,      'Meaning',  sim.needs.meaning,    '#CE93D8');

  // Separator
  row += BAR_H + 5;
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.beginPath();
  ctx.moveTo(cx + CARD_PAD, row);
  ctx.lineTo(cx + CARD_W - CARD_PAD, row);
  ctx.stroke();

  // Belief section label
  row += 12;
  ctx.font = '9px sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.fillText('BELIEF (You)', cx + CARD_PAD, row);

  const belief = sim.beliefs['player'];
  if (belief) {
    row += 4;
    drawBar(ctx, bx, row,    'Faith',    belief.faith,         '#FFD54F');
    row += BAR_H + 3;
    drawBar(ctx, bx, row,    'Underst',  belief.understanding, '#42A5F5');
    row += BAR_H + 3;
    drawBar(ctx, bx, row,    'Devotn',   belief.devotion,      '#FF8A65');
  }

  ctx.restore();
}
