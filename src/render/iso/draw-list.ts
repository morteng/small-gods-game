/**
 * Neutral entity draw list — the contract between the iso entity pass and its
 * two render backends (Canvas2D and the PixiJS WebGL layer).
 *
 * All placement math (world→screen, anchors, billboard scaling, pixel
 * rounding) is baked into the items by the emitters in iso-building /
 * iso-barrier / iso-sprites, so both executors draw pixel-identically by
 * construction. Items are ordered — the y-sort interleaving of buildings /
 * NPCs / vegetation / barriers is the item order.
 */

/** Source sub-rectangle for spritesheet frames (sheet px). */
export interface SrcFrame { sx: number; sy: number; sw: number; sh: number }

export type DrawItem =
  | {
      t: 'image';
      src: CanvasImageSource;
      /** Sheet frame; omitted = the whole source. */
      frame?: SrcFrame;
      dx: number; dy: number; dw: number; dh: number;
    }
  | { t: 'poly'; points: Array<{ x: number; y: number }>; color: string }
  | { t: 'circle'; cx: number; cy: number; r: number; color: string };

/**
 * Execute a draw list on a Canvas2D context — the original entity-pass
 * behavior, relocated. Image smoothing stays off (pixel-art 1:1 rule).
 */
export function executeDrawListCanvas(ctx: CanvasRenderingContext2D, items: readonly DrawItem[]): void {
  for (const it of items) {
    if (it.t === 'image') {
      ctx.imageSmoothingEnabled = false;
      if (it.frame) {
        ctx.drawImage(it.src, it.frame.sx, it.frame.sy, it.frame.sw, it.frame.sh, it.dx, it.dy, it.dw, it.dh);
      } else {
        ctx.drawImage(it.src, it.dx, it.dy, it.dw, it.dh);
      }
    } else if (it.t === 'poly') {
      ctx.fillStyle = it.color;
      ctx.beginPath();
      ctx.moveTo(it.points[0].x, it.points[0].y);
      for (let i = 1; i < it.points.length; i++) ctx.lineTo(it.points[i].x, it.points[i].y);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.fillStyle = it.color;
      ctx.beginPath();
      ctx.arc(it.cx, it.cy, it.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
