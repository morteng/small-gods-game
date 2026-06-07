/**
 * PixfluxCompiler — renders an AssetBrief into a PixelLab pixflux request.
 *
 * This is where pixflux-specific lore lives: iso views phrase as "isometric,
 * 3/4 top-down view" (front-view produced flat stickers); the functional door
 * is named explicitly so the visible door matches the walkable cell; the recipe
 * + native size come from the versioned view registry; paletteAnchors ride
 * through to a per-call color_image; massing guidance sets init_image strength
 * (the caller fills the actual init_image with the rendered massing).
 */
import type { PixelLabGenerateOpts } from '@/core/types';
import type { AssetBrief, AssetView, DoorFace } from '../asset-brief';
import { VIEW_RECIPES } from '../view-registry';
import { SUN_PROMPT } from '@/render/lighting';

export interface PromptCompiler {
  id: string;
  compile(brief: AssetBrief): PixelLabGenerateOpts;
}

const VIEW_LEAD: Record<AssetView, string> = {
  'iso-3q': 'isometric, 3/4 top-down view',
  'front-portrait': 'front-facing portrait',
  topdown: 'top-down view',
  side: 'side view',
};

/**
 * View-relative door phrasing. Diffusion text encoders reason in IMAGE space,
 * not world space, so cardinal "door on the south side" is the weakest possible
 * instruction. In our iso projection a footprint's `s` face points DOWN-LEFT
 * (front-left, toward the camera) and `e` points DOWN-RIGHT (front-right) — both
 * camera-facing; `n`/`w` are the hidden rear walls. `doorFace()` already prefers
 * the front walls, so we name the door's screen-relative wall + "facing the
 * viewer" to pin it to the exact face that maps to the walkable door cell.
 */
const DOOR_VIEW: Record<DoorFace, string> = {
  s: 'a single door centered on the front-left wall facing the viewer',
  e: 'a single door centered on the front-right wall facing the viewer',
  n: 'a single door on the rear-right wall',
  w: 'a single door on the rear-left wall',
};

export class PixfluxCompiler implements PromptCompiler {
  readonly id = 'pixellab.pixflux';

  compile(brief: AssetBrief): PixelLabGenerateOpts {
    const recipe = VIEW_RECIPES[brief.view];
    const size = recipe.nativeSize(brief);

    // The building SPRITE is the structure only — our iso renderer draws the
    // ground foundation + apron beneath it (iso-ground.ts). Asking the model for
    // ground makes it paint a base tile that fills the canvas and defeats
    // no_background (opaque bg) AND reads as "building on one tile". So we drop
    // the ground material from the image prompt (it stays in the brief for human
    // lore + palette) and negate ground/terrain below.
    const materialPhrases = brief.materials
      .filter((m) => m.part !== 'ground')
      .map((m) => `${m.material} ${m.part}`);
    // Isometric assets use the dedicated `isometric` + `view` request fields (a
    // real projection control), not a text hint. Other views keep the text lead.
    const isIso = brief.view === 'iso-3q';
    const parts = [
      isIso ? null : VIEW_LEAD[brief.view],
      brief.subject,
      ...brief.traits,
      ...materialPhrases,
      brief.door ? DOOR_VIEW[brief.door.face] : null,
      SUN_PROMPT, // canonical sun direction — consistent lighting across all art
    ].filter((p): p is string => !!p);

    const opts: PixelLabGenerateOpts = {
      prompt: parts.join(', '),
      width: size.width,
      height: size.height,
      outline: recipe.outline as PixelLabGenerateOpts['outline'],
      shading: recipe.shading as PixelLabGenerateOpts['shading'],
      detail: recipe.detail as PixelLabGenerateOpts['detail'],
      recipeVersion: recipe.recipeVersion,
      seed: brief.seed,
    };
    // Negatives go in the proper negative-prompt field, not jammed into the prompt.
    if (brief.negatives.length) opts.negativeDescription = brief.negatives.join(', ');
    if (isIso) {
      opts.isometric = true;
      opts.view = 'high top-down';
      opts.textGuidanceScale = 13; // stronger description adherence (door face is high-variance)
    }
    if (brief.paletteAnchors.length) opts.paletteAnchors = brief.paletteAnchors;
    if (brief.guidance && brief.guidance.source !== 'none') {
      opts.initImageStrength = brief.guidance.strength;
    }
    return opts;
  }
}
