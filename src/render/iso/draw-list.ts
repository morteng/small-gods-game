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

import type { RawMap } from '@/render/iso/sprite-canvas';

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
      maps?: { normal?: CanvasImageSource; material?: CanvasImageSource; materialData?: RawMap; emissive?: CanvasImageSource };
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
      /**
       * Above-ground override (G4 deck primitive). When set, the terrain-lift
       * pre-pass lifts this item to THIS normalised terrain elevation (heightfield
       * units) rather than sampling the ground under its foot — so a bridge deck or
       * elevated aqueduct rides its own feature-authored grade line over the water/
       * void below it, instead of snapping to the low terrain it spans. Piers, which
       * stand FROM the ground up to the deck, keep normal foot sampling (omit this).
       */
      liftElev?: number;
      /**
       * Explicit ground-contact point (world-screen px, pre-camera) the terrain-lift pre-pass
       * samples terrain at — overrides the derived `(dx+dw/2, dy+dh−footLift)` foot. A linear
       * barrier piece has no footprint-diamond to anchor on, so it passes its true grade anchor
       * (`worldToScreen(refX,refY)`): co-anchored pieces (a curtain chunk + its flanking tower)
       * then lift by the SAME sampled height and their seam can't split on a slope.
       */
      foot?: { sx: number; sy: number };
      /**
       * Per-instance snow whiten 0..1 (alpine fidelity): the lit shader mixes the
       * albedo toward the terrain snow tone on up-facing texels by this amount,
       * BEFORE band quantization. Set from `snowAmount01` at the entity's foot
       * tile for parametric plant/rock sprites; absent/0 = byte-identical output.
       */
      whiten?: number;
      /**
       * Horizontal mirror (pixel-perfect variety): the GPU flips the instance's
       * UV rect (and the shader negates the sampled normal's x) — no fractional
       * scaling, one source px still lands on one screen px. Foot anchor
       * unchanged. Set deterministically per plant/rock instance.
       */
      mirror?: boolean;
      /**
       * Skip this item in the cast-shadow pass entirely. Ground-cover habits
       * (grass/herb/fern tufts) are too small to read a silhouette shadow and
       * their instance count dwarfs everything else once density rises — a
       * shadow batch entry per blade would balloon the shadow pass for no
       * visible gain.
       */
      noShadow?: boolean;
      /**
       * Terrain CONTACT BLEND (rock/cover settling): near the FOOT of the sprite the
       * lit shader mixes the albedo toward `(r,g,b)` — the local ground colour, already
       * snow-mixed CPU-side (`render/ground-contact.ts`) — falling off to nothing `band`
       * of the drawn height up. So soil (and snow drift) banks against the base instead
       * of stopping dead at the silhouette. Absent / strength 0 = byte-identical output.
       */
      contact?: { r: number; g: number; b: number; strength: number; band: number };
    }
  | { t: 'poly'; points: Array<{ x: number; y: number }>; color: string }
  | { t: 'circle'; cx: number; cy: number; r: number; color: string };
