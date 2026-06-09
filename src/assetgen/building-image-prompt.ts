// src/assetgen/building-image-prompt.ts
// Deterministic, MODEL-AWARE text prompt for img2img building generation. The
// grey init image carries silhouette + rough materials; this adds a brief-derived
// description (subject, era, materials, door, traits) wrapped by a per-model-family
// preamble — Gemini-image wants natural-language "redraw the reference" editing
// instructions; OpenAI gpt-image wants a concise descriptive generation prompt.
// Output is a pure function of (rb, model) → safe to fold into the cache key.
import type { ResolvedBlueprint } from '@/blueprint/types';
import { toBrief } from '@/blueprint/compile/to-brief';

export type ImageModelFamily = 'gemini' | 'openai' | 'generic';

/** Map an OpenRouter image model id to its prompt family. */
export function imageModelFamily(model: string): ImageModelFamily {
  const m = model.toLowerCase();
  if (m.includes('gemini')) return 'gemini';            // check first: gemini ids also contain "-image"
  if (m.includes('gpt') || m.startsWith('openai/')) return 'openai';
  return 'generic';
}

const STYLE_TAIL =
  'Clean readable pixel shading, cohesive limited palette, fully transparent ' +
  'background, no ground, no shadow, centered.';

/** Brief-derived core, identical across families (pure function of the blueprint). */
function describeBuilding(rb: ResolvedBlueprint): string {
  const brief = toBrief(rb, 0);
  const mats = brief.materials.map(m => `${m.material} ${m.part}`).join(', ');
  const doorPhrase = brief.door ? ' with a visible wooden door' : '';
  const traits = brief.traits.slice(0, 4).join(', ');
  return `a ${brief.era} ${brief.subject}${doorPhrase}, ${mats}, ${traits}`;
}

export function buildingImagePrompt(rb: ResolvedBlueprint, model: string): string {
  const subject = describeBuilding(rb);
  switch (imageModelFamily(model)) {
    case 'gemini':
      return `Using the attached 3D massing render as a strict reference, redraw it ` +
        `as a crisp 2D isometric pixel-art video-game building sprite. Preserve the ` +
        `exact silhouette, proportions, roof pitch, chimney and door placement. ` +
        `Subject: ${subject}. ${STYLE_TAIL}`;
    case 'openai':
      return `Isometric pixel-art video-game building sprite matching the reference ` +
        `shape exactly (same silhouette, roof pitch, chimney and door placement). ` +
        `Subject: ${subject}. ${STYLE_TAIL}`;
    default:
      return `A crisp 2D isometric pixel-art video-game building sprite, redrawn from ` +
        `the reference shape (same silhouette, roof pitch, chimney, door). ` +
        `Subject: ${subject}. ${STYLE_TAIL}`;
  }
}
