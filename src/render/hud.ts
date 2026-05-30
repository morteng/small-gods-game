import { CANVAS, CANVAS_FONT } from '@/render/canvas-palette';

/** Render the player power HUD in the top-left corner */
export function drawPowerHud(
  ctx: CanvasRenderingContext2D,
  power: number,
  regenPerSec: number,
): void {
  const text = `⚡ ${power.toFixed(1)}  +${regenPerSec.toFixed(3)}/s`;
  const pad = 8;
  const pillH = 28;

  ctx.save();
  ctx.font = CANVAS_FONT.hud;
  const tw = ctx.measureText(text).width;
  const pillW = tw + pad * 2;

  // Dark pill background
  ctx.fillStyle = CANVAS.surface;
  ctx.beginPath();
  ctx.roundRect(8, 8, pillW, pillH, 6);
  ctx.fill();

  // Text
  ctx.fillStyle = CANVAS.faith;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 8 + pad, 8 + pillH / 2);
  ctx.restore();
}
