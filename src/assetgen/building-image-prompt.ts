// src/assetgen/building-image-prompt.ts
// Deterministic, MODEL-AWARE text prompt for img2img building generation. EVERY
// clause is derived from the ACTUAL resolved geometry of THIS asset — we compile the
// blueprint to its StructureSpec and describe only the primitives, materials and
// visible features that are really in the render. Nothing generic is asserted: an
// open market stall is never told it has "walls, a gable roof and a door", and the
// colour legend lists only the materials actually present. The init image carries
// silhouette + material-coded colour; this prompt names the edit per model family
// (FLUX wants positive "repaint image 1" prose, Gemini wants "redraw the reference",
// OpenAI a concise descriptive prompt). Agents can "colour" a variant via the
// blueprint's `notes` (art direction) + `palette` (preferred final colours); both
// ride on the resolved blueprint — its cache identity — so a customised variant
// gets its own cached/seeded sprite and becomes part of the default library.
// Output is a pure function of (rb, model) → safe to fold into the cache key.
import type { ResolvedBlueprint, ResolvedPart, WallFace } from '@/blueprint/types';
import { getPartType } from '@/blueprint/registry';
import { descriptorPhrase } from '@/blueprint/descriptors';
import { stagePhrase } from '@/blueprint/lifecycle';
import { toGeometry } from '@/blueprint/compile/to-geometry';
import type { StructureSpec } from '@/assetgen/compose';
import { MATERIAL_RGB, type Mat } from '@/assetgen/types';
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

// ── Material truth, read off the COMPILED geometry ──────────────────────────
// The init render colours each material with MATERIAL_RGB; the legend names the
// init colour + what the region IS so the model can locate it. Only materials
// actually present in this StructureSpec are listed.
const MAT_DESC: Record<Mat, { init: string; noun: string }> = {
  stone:   { init: 'grey', noun: 'stone' },
  timber:  { init: 'brown', noun: 'timber/wood' },
  plaster: { init: 'pale cream', noun: 'plaster, daub or canvas cloth' },
  thatch:  { init: 'tan', noun: 'thatch/straw' },
  tile:    { init: 'muted brown-grey', noun: 'roof tiles' },
  foliage: { init: 'green', noun: 'foliage' },
  bark:    { init: 'dark brown', noun: 'bark' },
  earth:   { init: 'earth brown', noun: 'bare earth' },
  metal:   { init: 'steel grey', noun: 'metal' },
  door:    { init: 'dark wood', noun: 'a door or recessed opening' },
  brick:   { init: 'red-brown', noun: 'brick' },
};

export { MAT_DESC };

/** The set of materials actually present in the compiled geometry, in MATERIAL_RGB order. */
export function presentMaterials(spec: StructureSpec): Mat[] {
  const seen = new Set<Mat>();
  for (const p of spec.parts) {
    if (p.prim === 'building') { if (p.wallMat) seen.add(p.wallMat); if (p.roofMat) seen.add(p.roofMat); continue; }
    if (p.prim === 'skirt') continue;                              // ground apron, not the body
    const mat = (p as { material?: Mat; mat?: Mat }).material ?? (p as { mat?: Mat }).mat;
    if (mat) seen.add(mat);
  }
  return (Object.keys(MATERIAL_RGB) as Mat[]).filter(m => seen.has(m));
}

/** Colour legend for ONLY the materials this asset actually uses. */
function referenceKey(mats: Mat[]): string {
  if (!mats.length) return '';
  const items = mats.map(m => `${MAT_DESC[m].init} = ${MAT_DESC[m].noun}`).join(', ');
  return `The reference is colour-coded by material — only these are present: ${items}. ` +
    `Use those regions to place materials correctly, then paint a richer final palette.`;
}

/** True if this StructureSpec is a walled building (vs an open frame / prop). */
function isWalledBuilding(spec: StructureSpec): boolean {
  return spec.parts.some(p => p.prim === 'building' || p.prim === 'cylinder');
}

/** Geometry-true phrases for each part, straight from its registered toBrief. */
function partPhrases(rb: ResolvedBlueprint): string[] {
  const ctx = { materials: rb.materials, footprint: rb.footprint };
  return rb.parts.map(p => { try { return getPartType(p.type).toBrief(p, ctx); } catch { return ''; } }).filter(Boolean);
}

/** The cleaned subject noun (preset/category), e.g. 'market stall'. */
function subjectNoun(rb: ResolvedBlueprint): string {
  return (rb.preset ?? rb.category ?? 'structure').replace(/_(small|large|tiny|big)$/, '').replace(/_/g, ' ');
}

/** Walled-building material clause ("plaster walls, thatch roof") — empty for open frames. */
function walledMaterialClause(spec: StructureSpec): string {
  const b = spec.parts.find(p => p.prim === 'building');
  if (!b || b.prim !== 'building') return '';
  const parts: string[] = [];
  if (b.wallMat) parts.push(`${b.wallMat} walls`);
  if (b.roofMat) parts.push(`${b.roofMat} roof`);
  return parts.join(', ');
}

/** Deterministic, geometry-TRUE description of ONLY what the render angle shows. A
 *  walled building lists storeys/roof/plan + visible chimneys/windows/dormers/door;
 *  an open frame (stall/tent/prop) states it has NO walls and lists its real parts. */
export function geometryDescription(rb: ResolvedBlueprint): string {
  if (rb.class !== 'building' && rb.class !== 'prop') return '';
  const spec = toGeometry(rb);

  if (!isWalledBuilding(spec)) {
    const comp = partPhrases(rb).join('; ');
    return `Geometry (match the reference exactly): an OPEN structure with no enclosing ` +
      `walls — ${comp}. Paint only the frame, canopy/roof and counter visible in the ` +
      `reference; keep it fully open and add nothing that the reference does not show.`;
  }

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

  const clauses: string[] = [`a ${plan} ${levels}-storey building with a ${roof} roof`];
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
const STYLE_TAIL =
  'Clean readable pixel shading, cohesive limited palette, no ground, no shadow, centered. ' +
  `Keep the ENTIRE background solid uniform pure magenta, RGB (${CHROMA_RGB.join(',')}), ` +
  'exactly as in the reference image. ' +
  'Do NOT use magenta, pink or purple anywhere on the building itself.';

/** Subject line — geometry-true: descriptor + era + the real parts, no invented door/walls.
 *  When a part phrase already names the subject (an open stall/tent), it leads as the richer
 *  description; otherwise the cleaned noun leads and the part phrases follow. */
function describeBuilding(rb: ResolvedBlueprint): string {
  const spec = toGeometry(rb);
  const desc = descriptorPhrase(rb.descriptors);
  const descPrefix = desc ? `${desc} ` : '';
  const era = rb.era ?? 'medieval';
  const stage = stagePhrase(rb.class, rb.stage);     // 'a burnt-out ruin of' etc. (replaces the article)
  const noun = subjectNoun(rb);
  const phrases = partPhrases(rb);

  // Walled building: noun leads, with its wall/roof materials + a visible door if real.
  if (isWalledBuilding(spec)) {
    const mat = walledMaterialClause(spec);
    const hasDoor = !!rb.parts.flatMap(p => p.features).find(f => f.type === 'door' && isVisibleFace(f.face));
    const door = hasDoor ? ' with a visible wooden door' : '';
    const tail = [mat, phrases.join(', ')].filter(Boolean).join(', ');
    const head = `${stage ?? 'a'} ${descPrefix}${era} ${noun}${door}`;
    return [head, tail].filter(Boolean).join(', ');
  }

  // Open frame / prop: prefer a part phrase that already names the subject.
  const richer = phrases.find(p => p.toLowerCase().includes(noun.toLowerCase()));
  if (richer) {
    const rest = phrases.filter(p => p !== richer);
    const core = `${stage ? `${stage} ` : 'a '}${descPrefix}${era} ${richer.replace(/^an?\s+/i, '')}`;
    return [core, rest.join(', ')].filter(Boolean).join(', ');
  }
  const head = `${stage ?? 'a'} ${descPrefix}${era} ${noun}`;
  return [head, phrases.join(', ')].filter(Boolean).join(', ');
}

/** Agent customisation woven into the prompt: free-text art direction (`notes`) +
 *  preferred final colours (`palette`). Both persist on the resolved blueprint, so a
 *  customised variant has its own cache identity and seeds into the default library. */
function customization(rb: ResolvedBlueprint): string {
  const bits: string[] = [];
  const pal = rb.palette;
  if (pal && (pal.walls || pal.roof || pal.trim)) {
    const cols = [
      pal.walls ? `walls ${pal.walls}` : '',
      pal.roof ? `roof ${pal.roof}` : '',
      pal.trim ? `trim ${pal.trim}` : '',
    ].filter(Boolean).join(', ');
    bits.push(`Preferred final colours — ${cols} (keep these off magenta, pink and purple).`);
  }
  if (rb.notes) bits.push(`Art direction: ${rb.notes}`);
  return bits.join(' ');
}

// Registration tolerates small silhouette deviation (see sprite-postprocess
// negotiation band), so the prompt asks for CLOSE adherence and invites the
// richness a bare massing render can't carry — texture, weathering, small details
// appropriate to whatever the structure actually is.
const DETAIL_INVITE =
  'Bring it to life with richly textured materials, weathering and small ' +
  'architectural details appropriate to the structure, while keeping the overall ' +
  'outline close to the reference.';

// FLUX.2 has NO negative prompts (per BFL's prompting guide) and wants natural-
// language prose that names the edit and binds the hex colour to a named object.
// So every "do NOT" of STYLE_TAIL is restated POSITIVELY.
const FLUX_TAIL =
  'Place the structure alone on a completely flat, solid, uniform background of pure ' +
  `magenta, hex #FF00FF, RGB (${CHROMA_RGB.join(',')}), that fills the entire frame ` +
  'edge to edge — the sprite floats on flat magenta with the ground and any shadow ' +
  'replaced by that same magenta. Keep every colour on the structure itself away from ' +
  'magenta, pink and purple. Clean readable pixel shading, cohesive limited palette, centered.';

export function buildingImagePrompt(rb: ResolvedBlueprint, model: string): string {
  const spec = toGeometry(rb);
  const subject = describeBuilding(rb);
  const geom = geometryDescription(rb);
  const legend = referenceKey(presentMaterials(spec));
  const custom = customization(rb);
  const customTail = custom ? ` ${custom}` : '';
  switch (imageModelFamily(model)) {
    case 'flux':
      // FLUX.2 editing convention: address the init as "image 1", lead with the
      // subject+action (word order is weighted), describe only what's wanted.
      return `Repaint image 1 as a crisp 2D isometric pixel-art video-game sprite ` +
        `in a 2:1 isometric perspective, keeping the silhouette, footprint and ` +
        `roof pitch of the colour-coded massing render. ${legend} ${geom} ` +
        `${DETAIL_INVITE} Subject: ${subject}.${customTail} ${FLUX_TAIL}`;
    case 'gemini':
      return `Using the attached colour-coded 3D massing render as a structural ` +
        `reference, redraw it as a crisp 2D isometric pixel-art video-game sprite. ` +
        `Match the silhouette, proportions and roof pitch closely. ` +
        `${legend} ${geom} ${DETAIL_INVITE} Subject: ${subject}.${customTail} ${STYLE_TAIL}`;
    case 'openai':
      return `Isometric pixel-art video-game sprite closely matching the ` +
        `reference shape (silhouette, roof pitch, element placement). ` +
        `${legend} ${geom} ${DETAIL_INVITE} Subject: ${subject}.${customTail} ${STYLE_TAIL}`;
    default:
      return `A crisp 2D isometric pixel-art video-game sprite, redrawn from ` +
        `the colour-coded reference shape. ` +
        `${legend} ${geom} ${DETAIL_INVITE} Subject: ${subject}.${customTail} ${STYLE_TAIL}`;
  }
}
