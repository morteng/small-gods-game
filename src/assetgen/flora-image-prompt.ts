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

/** img2img model for FLORA. Deliberately NOT the building model (Qwen): buildings
 *  want fidelity to their massing, but organic foliage reads best when the model is
 *  free to reinterpret the crown into painterly leaf clumps — an A/B on the English
 *  oak (2026-07-16) had FLUX.2 Klein clearly beat Gemini-flash (which stayed faithful
 *  to the low-poly facets) at a third of the cost. The seeder AND the runtime lookup
 *  key both read this, so a seeded flora sprite is found in-game by construction. */
export const FLORA_IMAGE_MODEL = 'black-forest-labs/flux.2-klein-4b';

const hex = (rgb: readonly number[]): string =>
  '#' + rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('');

/** Foliage phrase from leaf facts — needled conifer, fronds, blades, or broadleaf.
 *  Evergreen colours are bound explicitly (blue/deep green): without it the img2img
 *  model drifts a conifer toward autumn orange (scots-pine A/B, 2026-07-16). */
function foliage(b: Botanical): string {
  if (b.leafType === 'needle' || b.leafType === 'scale') return 'fine blue-green needled evergreen foliage';
  if (b.leafType === 'frond') return 'arching feathery green fronds';
  if (b.leafType === 'blade') return 'slender grassy blades';
  if (b.leafPhenology === 'evergreen') return 'dense deep-green glossy evergreen leaves';
  return 'soft broad green leaves';
}

/** An evergreen species must stay green year-round — the anti-autumn anchor that
 *  keeps a conifer/holly from being repainted in seasonal yellow/orange/red. */
function isEvergreen(b: Botanical): boolean {
  return b.leafPhenology === 'evergreen' || b.leafType === 'needle' || b.leafType === 'scale';
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

/** Subject clauses for the PRESET rock kinds (no flora-DB species behind them —
 *  without this they fell through to "A single plant" and the repaint clause asked
 *  for botanical colours on a boulder). Wording follows the reference STUDYs
 *  (reference-library/tti/rock-*): knapped facets + lichen for boulders; for the
 *  outcrop the anti-masonry clause is load-bearing — "strata + blocky jointed"
 *  phrasing makes image models draw cut-block masonry. */
const ROCK_SUBJECTS: Record<string, string> = {
  boulder: 'A single large weathered grey granite boulder, broad softly-rounded knapped facets, pale lichen patches and hairline cracks',
  rock_small: 'A single small weathered grey granite boulder with softly-rounded knapped facets and pale lichen patches',
  rock_pile: 'A low pile of weathered grey field stones, rounded and lichen-flecked, long settled together',
  pebbles: 'A small scatter of weathered grey pebbles, partly sunken as if long settled into the soil',
  standing_stone: 'A single tall ancient standing stone, a weathered moss-flecked menhir set upright in the earth',
  shrine_stone: 'A single small sacred stone, weathered and moss-flecked',
  ore_vein: 'A single weathered grey rock knob shot through with glinting metallic ore seams',
  rock_outcrop: 'A craggy natural bedrock outcrop, tilted uneven rock layers with deep natural fractures — wild natural stone, never masonry, no cut blocks, no straight edges',
};

/**
 * Build the img2img prompt for a flora species. `rb.preset` is the species id
 * (the synthesized blueprint's preset name). Falls back to a generic plant prompt
 * for an unknown id so the pipeline never throws. Rock blueprints (flora-DB
 * habit:'rock' species AND the preset rock kinds) take a stone repaint clause —
 * muted mineral colours, never "botanical".
 */
export function floraImagePrompt(rb: ResolvedBlueprint, _model?: string): string {
  const chroma = hex(CHROMA_RGB);
  const sp = rb.preset ? getFloraSpecies(rb.preset) : undefined;
  const presetRock = rb.preset ? ROCK_SUBJECTS[rb.preset] : undefined;
  const isRock = !!presetRock || sp?.botanical.habit === 'rock';
  const head = presetRock ?? (sp ? subject(sp.identity.commonName, sp.botanical) : 'A single plant');
  const evergreen = !isRock && sp && isEvergreen(sp.botanical)
    ? ' Keep the foliage evergreen green all year — never autumn yellow, orange or red.'
    : '';
  const repaint = isRock
    ? 'Repaint the grey shape as weathered natural stone in muted mineral greys with subtle warm-cool variation, but PRESERVE its exact silhouette, height and proportions. Wild natural rock — never masonry, no cut blocks, no plants growing on it.'
    : `Repaint the grey shape as this plant in realistic botanical colours, but PRESERVE its exact silhouette, height and proportions.${evergreen}`;
  return [
    `${head}, painted as a crisp hand-painted pixel-art game sprite in three-quarter top-down view, soft natural daylight from the upper-left.`,
    repaint,
    `The background is solid flat ${chroma} magenta and stays solid ${chroma} magenta — no ground, no shadow, no scenery, no extra plants.`,
  ].join(' ');
}
