// src/assetgen/building-image-prompt.ts
// Deterministic text prompt for img2img building generation. The grey init image
// carries the silhouette + rough materials; this adds a fixed pixel-art house
// style + a brief-derived description (subject, era, materials, door) so the
// model renders the right kind/era. Output is part of the generation cache key,
// so it MUST be a pure function of the resolved blueprint.
import type { ResolvedBlueprint } from '@/blueprint/types';
import { toBrief } from '@/blueprint/compile/to-brief';

export const BUILDING_STYLE_PREAMBLE =
  'A crisp 2D isometric pixel-art video-game building sprite. ' +
  'Redraw the provided shape exactly: keep its silhouette, proportions, roof ' +
  'pitch, chimney and door placement. Clean readable pixel shading, cohesive ' +
  'limited palette, transparent background, no ground, no shadow, centered. ';

export function buildingImagePrompt(rb: ResolvedBlueprint): string {
  const brief = toBrief(rb, 0);
  const mats = brief.materials.map(m => `${m.material} ${m.part}`).join(', ');
  const doorPhrase = brief.door ? ' with a visible wooden door' : '';
  const traits = brief.traits.slice(0, 4).join(', ');
  return `${BUILDING_STYLE_PREAMBLE}Subject: a ${brief.era} ${brief.subject}${doorPhrase}. ` +
         `Materials: ${mats}. Details: ${traits}.`;
}
