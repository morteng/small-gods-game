// src/assetgen/flora-image-prompt.ts
// Deterministic, fact-grounded img2img prompt for FLORA generation — the plant
// analogue of building-image-prompt.ts. Every clause is earned by the species'
// real botanical facts (flora-facts-data.ts): habit, mature height, crown shape,
// leaf type/phenology, bark. The init image already carries the L-system
// silhouette over a magenta chroma field, so the prompt's job is: name the plant,
// state its real form + foliage, and demand the chroma background be preserved.
//
// FLUX.2 img2img guidance (black-forest-labs/skills): natural language, subject-
// first, an EDIT instruction that says what changes and what to PRESERVE, colour
// bound to the named object, positive-only phrasing. Output is a pure function of
// (rb, model) so it folds into the generation cache key.
import type { ResolvedBlueprint } from '@/blueprint/types';
import { getFloraSpecies } from '@/flora/flora-registry';
import type { Botanical } from '@/flora/flora-species';
import { CHROMA_RGB } from '@/render/chroma-key';

const hex = (rgb: readonly number[]): string =>
  '#' + rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('');

/** Foliage phrase from leaf facts — needled conifer, fronds, blades, or broadleaf. */
function foliage(b: Botanical): string {
  if (b.leafType === 'needle' || b.leafType === 'scale') return 'fine needled evergreen foliage';
  if (b.leafType === 'frond') return 'arching feathery fronds';
  if (b.leafType === 'blade') return 'slender grassy blades';
  if (b.leafPhenology === 'evergreen') return 'dense glossy evergreen leaves';
  return 'soft broad green leaves';
}

/** Subject clause from habit + measured form. */
function subject(name: string, b: Botanical): string {
  const h = Math.round((b.matureHeight_m.min + b.matureHeight_m.max) / 2);
  const crown = b.crownShape ?? 'rounded';
  // barkTexture is sometimes already phrased "...bark" — don't double the word.
  const bark = b.barkTexture
    ? `, ${b.barkTexture}${/bark\s*$/i.test(b.barkTexture) ? '' : ' bark'}`
    : '';
  switch (b.habit) {
    case 'tree':
      return `A single ${name} tree, about ${h} m tall, with a ${crown} crown of ${foliage(b)}${bark}, on a clear straight trunk`;
    case 'shrub':
      return `A single ${name}, a low woody shrub of ${foliage(b)}`;
    case 'fern':
      return `A single ${name}, a clump of ${foliage(b)}`;
    case 'herb':
    case 'grass':
      return `A small ${name}, a low ${foliage(b)} plant`;
    case 'rock':
      return `A single weathered ${name}, a mossy lichen-streaked stone`;
    default:
      return `A single ${name}`;
  }
}

/**
 * Build the img2img prompt for a flora species. `rb.preset` is the species id
 * (the synthesized blueprint's preset name). Falls back to a generic plant prompt
 * for an unknown id so the pipeline never throws.
 */
export function floraImagePrompt(rb: ResolvedBlueprint, _model?: string): string {
  const chroma = hex(CHROMA_RGB);
  const sp = rb.preset ? getFloraSpecies(rb.preset) : undefined;
  const head = sp ? subject(sp.identity.commonName, sp.botanical) : 'A single plant';
  return [
    `${head}, painted as a crisp hand-painted pixel-art game sprite in three-quarter top-down view, soft natural daylight from the upper-left.`,
    `Repaint the grey shape as this plant in realistic botanical colours, but PRESERVE its exact silhouette, height and proportions.`,
    `The background is solid flat ${chroma} magenta and stays solid ${chroma} magenta — no ground, no shadow, no scenery, no extra plants.`,
  ].join(' ');
}
