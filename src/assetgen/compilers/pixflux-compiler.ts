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

const FACE_WORD: Record<DoorFace, string> = { n: 'north', e: 'east', s: 'south', w: 'west' };

export class PixfluxCompiler implements PromptCompiler {
  readonly id = 'pixellab.pixflux';

  compile(brief: AssetBrief): PixelLabGenerateOpts {
    const recipe = VIEW_RECIPES[brief.view];
    const size = recipe.nativeSize(brief);

    const materialPhrases = brief.materials.map((m) => `${m.material} ${m.part}`);
    const parts = [
      VIEW_LEAD[brief.view],
      brief.subject,
      ...brief.traits,
      ...materialPhrases,
      brief.door ? `door on the ${FACE_WORD[brief.door.face]} side` : null,
    ].filter((p): p is string => !!p);

    let prompt = parts.join(', ');
    if (brief.negatives.length) prompt += `. avoid: ${brief.negatives.join(', ')}`;

    const opts: PixelLabGenerateOpts = {
      prompt,
      width: size.width,
      height: size.height,
      outline: recipe.outline as PixelLabGenerateOpts['outline'],
      shading: recipe.shading as PixelLabGenerateOpts['shading'],
      detail: recipe.detail as PixelLabGenerateOpts['detail'],
      recipeVersion: recipe.recipeVersion,
      seed: brief.seed,
    };
    if (brief.paletteAnchors.length) opts.paletteAnchors = brief.paletteAnchors;
    if (brief.guidance?.source === 'massing') {
      opts.initImageStrength = brief.guidance.strength;
    }
    return opts;
  }
}
