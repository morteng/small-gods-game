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
      /**
       * Co-registered PBR companion maps (same dimensions as `src`, never
       * framed). Present only on building-pack sprites; the WebGL backend
       * lights items that carry a normal map, the Canvas2D executor ignores
       * them (lighting is a WebGL-only enhancement).
       */
      maps?: { normal?: CanvasImageSource; material?: CanvasImageSource };
      /**
       * Cast-shadow hint (WebGL backend only). `footLift` = screen px the
       * ground-contact point sits ABOVE the sprite's bottom edge (buildings
       * anchor at their footprint-diamond centre ≈ dw/4 up; a foot-anchored
       * billboard like a tree sits AT its bottom edge ⇒ 0). `groundR` =
       * ground-contact half-width (px) for the blob shadow. Absent ⇒ derived
       * defaults (maps ⇒ dw/4 lift, blob radius ⇒ 0.45·dw).
       */
      shadow?: { footLift?: number; groundR?: number };
      /**
       * Geometry-baked ground cast shadow (from `composeStructure`): a pre-rendered
       * dark mask + its offset (px) from this item's (dx,dy). The WebGL backend
       * blits it on the ground under the sprite when shadowMode is 'geometry'.
       */
      shadowSprite?: { src: CanvasImageSource; dx: number; dy: number };
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
