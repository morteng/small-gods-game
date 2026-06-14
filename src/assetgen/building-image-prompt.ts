// src/assetgen/building-image-prompt.ts
// Deterministic, MODEL-AWARE text prompt for img2img building generation. The
// grey init image carries silhouette + rough materials; this adds a brief-derived
// description (subject, era, materials, door, traits) wrapped by a per-model-family
// preamble — Gemini-image wants natural-language "redraw the reference" editing
// instructions; OpenAI gpt-image wants a concise descriptive generation prompt.
// Output is a pure function of (rb, model) → safe to fold into the cache key.
import type { ResolvedBlueprint, ResolvedPart, WallFace } from '@/blueprint/types';
import { toBrief } from '@/blueprint/compile/to-brief';
import { descriptorPhrase } from '@/blueprint/descriptors';
import { CHROMA_RGB } from '@/render/chroma-key';

export type ImageModelFamily = 'gemini' | 'openai' | 'flux' | 'generic';

// Iso-3q screen direction each wall face presents (2:1 projection: +y→lower-left,
// +x→lower-right). South is the canonical front, lower-left — what the player sees.
const FACE_ISO: Record<WallFace, string> = {
  south: 'the front-left wall, facing lower-left',
  east: 'the front-right wall, facing lower-right',
  north: 'the rear wall, facing upper-right',
  west: 'the rear-left wall, facing upper-left',
};

const PLAN_WORD: Record<string, string> = { rect: 'rectangular', round: 'round', stepped: 'stepped', L: 'L-shaped', cross: 'cross-shaped' };

function plural(n: number, one: string, many = `${one}s`): string { return `${n} ${n === 1 ? one : many}`; }

// The iso-3q camera sees the TOP + the south (front-left) and east (front-right)
// walls. North/west walls are hidden, so wall features on them must NOT be
// described — telling the model to paint windows it cannot see makes it invent
// extra ones on the visible faces. Roof features (chimneys, dormers) read as
// visible (face undefined ⇒ on the roof / front slope).
const VISIBLE_FACES = new Set<WallFace>(['south', 'east']);
function isVisibleFace(face: WallFace | undefined): boolean {
  return face === undefined || VISIBLE_FACES.has(face);
}

/** Count features of `type` that the camera can actually SEE (visible wall faces
 *  + roof). `kind` optionally narrows by a param kind (e.g. vent → chimney). */
function countVisible(rb: ResolvedBlueprint, type: string, kind?: string): number {
  let n = 0;
  for (const p of rb.parts) for (const f of p.features) {
    if (f.type !== type) continue;
    if (kind && f.params.kind !== kind) continue;
    if (!isVisibleFace(f.face)) continue;
    n++;
  }
  return n;
}

/** Deterministic, geometry-TRUE description of ONLY what the render angle shows:
 *  visible element counts + the (visible) door facing, read straight off the
 *  resolved blueprint so the prompt can't drift from — or over-state — what the
 *  model actually sees (it says "two chimneys" only when two are visible). */
export function geometryDescription(rb: ResolvedBlueprint): string {
  if (rb.class !== 'building') return '';
  const body: ResolvedPart | undefined = rb.parts.find(p => p.type === 'body') ?? rb.parts[0];
  const levels = Math.max(1, (body?.params.levels as number) ?? 1);
  const roof = (body?.params.roof as string) ?? 'gable';
  const plan = PLAN_WORD[(body?.params.plan as string) ?? 'rect'] ?? 'rectangular';

  const chimneys = countVisible(rb, 'vent', 'chimney') || countVisible(rb, 'vent');
  const windows = countVisible(rb, 'window');
  const dormers = countVisible(rb, 'dormer');

  // Only describe a door the camera can see; a door on a hidden wall is silently
  // omitted (the longhouse's rear cross-passage door, say).
  const doorFeat = rb.parts.flatMap(p => p.features).find(f => f.type === 'door' && isVisibleFace(f.face));
  const doorFace = doorFeat ? (doorFeat.face ?? 'south') as WallFace : null;

  const clauses: string[] = [
    `a ${plan} ${levels}-storey building with a ${roof} roof`,
  ];
  if (chimneys) clauses.push(`exactly ${plural(chimneys, 'chimney')} on the roof`);
  if (windows) clauses.push(`exactly ${plural(windows, 'visible window')}`);
  if (dormers) clauses.push(`${plural(dormers, 'roof dormer')}`);
  if (doorFace) clauses.push(`a single wooden door on ${FACE_ISO[doorFace]}`);

  return `Geometry (only what is visible from this angle — match exactly): ${clauses.join('; ')}. ` +
    `Show ONLY these visible elements; do not add windows, doors or chimneys on the ` +
    `near walls, and draw nothing on the hidden rear walls.`;
}

/** Map an OpenRouter image model id to its prompt family. */
export function imageModelFamily(model: string): ImageModelFamily {
  const m = model.toLowerCase();
  if (m.includes('gemini')) return 'gemini';            // check first: gemini ids also contain "-image"
  if (m.includes('gpt') || m.startsWith('openai/')) return 'openai';
  if (m.includes('flux') || m.includes('black-forest')) return 'flux';
  return 'generic';
}

// We key the background out ourselves (see chroma-key.ts), so we DEMAND a solid
// chroma fill rather than trusting the model to emit alpha (which it bakes opaque
// half the time). The init image's background is already this exact magenta
// (compositeOverChroma), so "same as the reference" reinforces the text demand.
// The colour must match CHROMA_RGB exactly.
const STYLE_TAIL =
  'Clean readable pixel shading, cohesive limited palette, no ground, no shadow, centered. ' +
  `Keep the ENTIRE background solid uniform pure magenta, RGB (${CHROMA_RGB.join(',')}), ` +
  'exactly as in the reference image. ' +
  'Do NOT use magenta, pink or purple anywhere on the building itself.';

/** Brief-derived core, identical across families (pure function of the blueprint). */
function describeBuilding(rb: ResolvedBlueprint): string {
  const brief = toBrief(rb, 0);
  const mats = brief.materials.map(m => `${m.material} ${m.part}`).join(', ');
  const doorPhrase = brief.door ? ' with a visible wooden door' : '';
  const traits = brief.traits.slice(0, 4).join(', ');
  // Qualitative descriptors (rich/poor, ornate/crude, weathered…) lead the subject
  // so the painted art matches the geometry/material bias the descriptors applied.
  const desc = descriptorPhrase(rb.descriptors);
  return `a ${desc ? `${desc} ` : ''}${brief.era} ${brief.subject}${doorPhrase}, ${mats}, ${traits}`;
}

// Registration tolerates small silhouette deviation (see sprite-postprocess
// negotiation band), so the prompt asks for CLOSE adherence and invites the
// richness a bare massing render can't carry — texture, weathering, small
// architectural details. Demanding the "exact" silhouette produced flat,
// primitive repaints of the flat-shaded init.
const DETAIL_INVITE =
  'Bring it to life with richly textured materials, weathering, and small ' +
  'architectural details (window frames, beams, stonework variation) while ' +
  'keeping the overall outline close to the reference.';

// The init render is colour-coded by MATERIAL (timber=brown, thatch/straw=tan,
// stone=grey, brick chimney=red-brown, door=dark wood). Telling the model the
// colours are a material/part key — not the final palette — lets it read the
// structure (which region is roof vs wall vs door vs chimney) and restyle freely.
const REFERENCE_KEY =
  'The reference is colour-coded by material: grey = stone walls, brown = timber, ' +
  'tan = thatch/straw roof, red-brown = brick chimneys, dark = the wooden door. ' +
  'Use those regions to place materials correctly, then paint a richer final palette.';

// FLUX.2 has NO negative prompts (per BFL's prompting guide) and wants natural-
// language prose that names the edit and binds the hex colour to a named object.
// So every "do NOT" of STYLE_TAIL is restated POSITIVELY: the background is a
// thing that "fills the whole frame" rather than a "no ground/no shadow" denial,
// and the chroma hex is attached to "a solid background" so it lands reliably.
const FLUX_TAIL =
  'Place the building alone on a completely flat, solid, uniform background of pure ' +
  `magenta, hex #FF00FF, RGB (${CHROMA_RGB.join(',')}), that fills the entire frame ` +
  'edge to edge — the sprite floats on flat magenta with the ground and any shadow ' +
  'replaced by that same magenta. Keep every colour on the building itself away from ' +
  'magenta, pink and purple. Clean readable pixel shading, cohesive limited palette, centered.';

export function buildingImagePrompt(rb: ResolvedBlueprint, model: string): string {
  const subject = describeBuilding(rb);
  const geom = geometryDescription(rb);
  switch (imageModelFamily(model)) {
    case 'flux':
      // FLUX.2 editing convention: address the init as "image 1", lead with the
      // subject+action (word order is weighted), describe only what's wanted.
      return `Repaint image 1 as a crisp 2D isometric pixel-art video-game building ` +
        `sprite in a 2:1 isometric perspective, keeping the silhouette, footprint and ` +
        `roof pitch of the colour-coded massing render. ${REFERENCE_KEY} ${geom} ` +
        `${DETAIL_INVITE} Subject: ${subject}. ${FLUX_TAIL}`;
    case 'gemini':
      return `Using the attached colour-coded 3D massing render as a structural ` +
        `reference, redraw it as a crisp 2D isometric pixel-art video-game building ` +
        `sprite. Match the silhouette, proportions and roof pitch closely. ` +
        `${REFERENCE_KEY} ${geom} ${DETAIL_INVITE} Subject: ${subject}. ${STYLE_TAIL}`;
    case 'openai':
      return `Isometric pixel-art video-game building sprite closely matching the ` +
        `reference shape (silhouette, roof pitch, element placement). ` +
        `${REFERENCE_KEY} ${geom} ${DETAIL_INVITE} Subject: ${subject}. ${STYLE_TAIL}`;
    default:
      return `A crisp 2D isometric pixel-art video-game building sprite, redrawn from ` +
        `the colour-coded reference shape. ` +
        `${REFERENCE_KEY} ${geom} ${DETAIL_INVITE} Subject: ${subject}. ${STYLE_TAIL}`;
  }
}
