/**
 * Neutral entity draw list — the contract between the iso entity-pass emitters
 * and the WebGPU scene renderer.
 *
 * All placement math (world→screen, anchors, billboard scaling, pixel rounding)
 * is baked into the items by the emitters in iso-building / iso-barrier /
 * iso-sprites; the GPU scene (`src/render/gpu/`) consumes them. Items are
 * ordered — the y-sort interleaving of buildings / NPCs / vegetation / barriers
 * is the item order.
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
       * framed). Present only on building-pack sprites; the GPU scene lights
       * items that carry a normal map.
       */
      maps?: { normal?: CanvasImageSource; material?: CanvasImageSource };
      /**
       * Cast-shadow hint. `footLift` = screen px the ground-contact point sits
       * ABOVE the sprite's bottom edge (buildings anchor at their
       * footprint-diamond centre ≈ dw/4 up; a foot-anchored billboard like a
       * tree sits AT its bottom edge ⇒ 0). `groundR` = ground-contact
       * half-width (px) for the blob shadow. Absent ⇒ derived defaults (maps ⇒
       * dw/4 lift, blob radius ⇒ 0.45·dw).
       */
      shadow?: { footLift?: number; groundR?: number };
      /**
       * Geometry-baked ground cast shadow (from `composeStructure`): a pre-rendered
       * dark mask + its offset (px) from this item's (dx,dy). The GPU scene
       * blits it on the ground under the sprite when shadowMode is 'geometry'.
       */
      shadowSprite?: { src: CanvasImageSource; dx: number; dy: number };
    }
  | { t: 'poly'; points: Array<{ x: number; y: number }>; color: string }
  | { t: 'circle'; cx: number; cy: number; r: number; color: string };
