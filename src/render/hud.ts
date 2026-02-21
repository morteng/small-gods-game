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
  ctx.font = 'bold 13px monospace';
  const tw = ctx.measureText(text).width;
  const pillW = tw + pad * 2;

  // Dark pill background
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  ctx.beginPath();
  ctx.roundRect(8, 8, pillW, pillH, 6);
  ctx.fill();

  // Text
  ctx.fillStyle = '#FFD700';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 8 + pad, 8 + pillH / 2);
  ctx.restore();
}
