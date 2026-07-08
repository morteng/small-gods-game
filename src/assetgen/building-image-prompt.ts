// src/assetgen/building-image-prompt.ts
// Deterministic, MODEL-AWARE img2img prompt for building generation. EVERY clause is
// earned by the ACTUAL resolved geometry of THIS asset — we compile the blueprint to
// its StructureSpec and describe only the primitives, materials and visible features
// that are really in the render. Nothing generic is asserted and nothing is padded:
// no fixed preamble, no boilerplate "video-game sprite, masterpiece, highly detailed"
// filler. An open market stall is never told it has "walls, a gable roof and a door";
// a humble ridge smoke-louvre is never called a chimney; the colour legend lists only
// the materials actually present, each bound to its hex.
//
// Grounded in Black Forest Labs' FLUX.2 img2img prompting guidance
// (github.com/black-forest-labs/skills): natural-language, ~15–75 words, subject-first
// ordering, an EDIT instruction that says what changes and what to PRESERVE, hex bound
// to the named object ("the roof is #hex", never "use #hex"), and positive-only phrasing
// (FLUX has no negative prompts). The init image already carries silhouette + material-
// coded colour, so the prompt's job is: name the subject, state the real geometry, map
// the reference colours, and demand the chroma background.
//
// Output is a pure function of (rb, model) → safe to fold into the cache key.
import type { ResolvedBlueprint, ResolvedPart, WallFace } from '@/blueprint/types';
import { getPartType } from '@/blueprint/registry';
import { descriptorPhrase } from '@/blueprint/descriptors';
import { stagePhrase } from '@/blueprint/lifecycle';
import { ROOF_KIND } from '@/blueprint/parts/body';
import { toGeometry } from '@/blueprint/compile/to-geometry';
import type { StructureSpec } from '@/assetgen/compose';
import { MATERIAL_RGB, type Mat } from '@/assetgen/types';
import { CHROMA_RGB } from '@/render/chroma-key';

export type ImageModelFamily = 'gemini' | 'openai' | 'flux' | 'generic';

// Iso-3q screen direction each wall face presents (2:1 projection: +y→lower-left,
// +x→lower-right). South is the canonical front, lower-left — what the player sees.
const FACE_ISO: Record<WallFace, string> = {
  south: 'the front-left wall (facing lower-left)',
  east: 'the front-right wall (facing lower-right)',
  north: 'the rear wall (facing upper-right)',
  west: 'the rear-left wall (facing upper-left)',
};

const PLAN_WORD: Record<string, string> = { rect: 'rectangular', round: 'round', stepped: 'stepped', L: 'L-shaped', cross: 'cross-shaped' };

function plural(n: number, one: string, many = `${one}s`): string { return `${n} ${n === 1 ? one : many}`; }

// The iso-3q camera sees the TOP + the south (front-left) and east (front-right)
// walls. North/west walls are hidden, so wall features on them must NOT be
// described — telling the model to paint windows it cannot see makes it invent
// extra ones on the visible faces. Roof features (vents, dormers) read as visible.
const VISIBLE_FACES = new Set<WallFace>(['south', 'east']);
function isVisibleFace(face: WallFace | undefined): boolean {
  return face === undefined || VISIBLE_FACES.has(face);
}

// ── Roof shape → an honest pitch description (incl. slope DIRECTION) ─────────
// The author roof name (e.g. 'lean_to') maps through ROOF_KIND to a runtime kind;
// each kind gets a phrase that tells the model the real pitch — crucially the
// asymmetric ones, so a mono-pitch shed is drawn high-at-the-back, not symmetric.
const ROOF_PHRASE: Record<string, string> = {
  gable: 'a pitched gable roof',
  hip: 'a hipped roof (slopes on all four sides)',
  half_hip: 'a half-hipped (gablet) roof',
  pyramidal: 'a pyramidal roof rising to a point',
  flat: 'a flat roof',
  shed: 'a single-slope shed roof, high at the rear sloping to a low front eave',
};
function roofPhrase(roofParam: string): string {
  const kind = ROOF_KIND[roofParam] ?? 'gable';
  return ROOF_PHRASE[kind] ?? ROOF_PHRASE.gable;
}

// ── Vent truth: describe each smoke vent by what it ACTUALLY is ──────────────
// A ridge smoke-hole/louver is a slatted timber vent, NOT a chimney; calling it a
// chimney is exactly the bug that made FLUX paint a brick stack on an early-medieval
// commoner's cottage. Masonry chimneys are stone in the medieval period (brick is a
// late, Tudor-era covering) — bind the period material so the painted stack is right.
function ventPhrase(kind: string, count: number, era: string): string {
  switch (kind) {
    case 'chimney': {
      const mat = era === 'current' ? 'brick' : 'stone';
      return `${plural(count, `${mat} chimney`, `${mat} chimneys`)} rising from the roof`;
    }
    case 'pipe':
      return `${plural(count, 'slim metal flue-pipe')} on the roof`;
    case 'smokehole':
    default:
      return `${plural(count, 'small timber smoke-louver')} on the ridge (a slatted vent, not a chimney)`;
  }
}

/** A GENERALIZED vent clause (TTI): names the feature's identity/material without a hard count,
 *  so the model is free to choose how many. `has` = at least one is present. */
function ventPhraseGeneralized(kind: string, era: string): string {
  switch (kind) {
    case 'chimney': return `${era === 'current' ? 'brick' : 'stone'} chimneys rising from the roof`;
    case 'pipe':    return `slim metal flue-pipes on the roof`;
    case 'smokehole':
    default:        return `a timber smoke-louver on the ridge (a slatted vent, not a chimney)`;
  }
}

/** Visible vents grouped by their real kind, in a stable order. */
function visibleVents(rb: ResolvedBlueprint): Array<{ kind: string; count: number }> {
  const counts = new Map<string, number>();
  for (const p of rb.parts) for (const f of p.features) {
    if (f.type !== 'vent') continue;
    // A wall-placement stack climbs from the ground PAST the ridge, so it reads against the
    // sky from any angle — count it visible even on a back gable (unlike a face-bound opening).
    const wallStack = f.params.placement === 'wall';
    if (!wallStack && !isVisibleFace(f.face)) continue;
    const kind = (f.params.kind as string) ?? 'smokehole';
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  return ['chimney', 'smokehole', 'pipe'].filter(k => counts.has(k)).map(k => ({ kind: k, count: counts.get(k)! }));
}

/** Count visible features of `type` (any kind) on visible faces + the roof. */
function countVisible(rb: ResolvedBlueprint, type: string): number {
  let n = 0;
  for (const p of rb.parts) for (const f of p.features) {
    if (f.type === type && isVisibleFace(f.face)) n++;
  }
  return n;
}

// ── Material truth, read off the COMPILED geometry ──────────────────────────
// The init render colours each material with MATERIAL_RGB; the legend names the
// init colour + its hex + what the region IS so the model can locate it. Only
// materials actually present in this StructureSpec are listed.
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
  glass:   { init: 'dark slate-blue', noun: 'a glazed window pane' },
};

export { MAT_DESC };

const hex = (m: Mat): string => '#' + MATERIAL_RGB[m].map(c => c.toString(16).padStart(2, '0')).join('');

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

/** Colour+hex legend for ONLY the materials this asset actually uses. The
 *  "only these are present: … . Use those regions" framing is the geometry-truth
 *  contract (guarded by building-image-prompt-truth.test.ts). */
function referenceKey(mats: Mat[]): string {
  if (!mats.length) return '';
  const items = mats.map(m => `${MAT_DESC[m].init} ${hex(m)} = ${MAT_DESC[m].noun}`).join(', ');
  return `The reference is colour-coded by material — only these are present: ${items}.`;
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

/** Walled-building material clause ("wattle walls and a thatch roof"). */
function walledMaterialClause(spec: StructureSpec): string {
  const b = spec.parts.find(p => p.prim === 'building');
  if (!b || b.prim !== 'building') return '';
  const parts: string[] = [];
  if (b.wallMat) parts.push(`${b.wallMat} walls`);
  if (b.roofMat) parts.push(`a ${b.roofMat} roof`);
  return parts.join(' and ');
}

/** Deterministic, geometry-TRUE sentence of ONLY what the render angle shows. A
 *  walled building states plan/storeys/roof-pitch + visible vents/windows/dormers/door
 *  (each by its real identity); an open frame (stall/tent/prop) states it has NO walls
 *  and lists its real parts. Exported for the truth tests. */
export function geometryDescription(rb: ResolvedBlueprint, opts: { generalized?: boolean } = {}): string {
  if (rb.class !== 'building' && rb.class !== 'prop') return '';
  const gen = opts.generalized === true;
  const spec = toGeometry(rb);

  if (!isWalledBuilding(spec)) {
    const comp = partPhrases(rb).join('; ');
    // Generalized (TTI): state the open form + its parts, without the img2img "paint only the
    // reference" repaint instruction (there is no reference image in a text-to-image call).
    if (gen) return `It is an OPEN structure with no enclosing walls — ${comp}.`;
    return `It is an OPEN structure with no enclosing walls — ${comp}. Paint only the ` +
      `frame, canopy and counter visible in the reference; keep it fully open and add ` +
      `nothing the reference does not show.`;
  }

  const body: ResolvedPart | undefined = rb.parts.find(p => p.type === 'body') ?? rb.parts[0];
  const levels = Math.max(1, (body?.params.levels as number) ?? 1);
  const roof = (body?.params.roof as string) ?? 'gable';
  const plan = PLAN_WORD[(body?.params.plan as string) ?? 'rect'] ?? 'rectangular';
  const era = rb.era ?? 'medieval';

  // Only describe a door the camera can see; a door on a hidden wall is silently
  // omitted (the longhouse's rear cross-passage door, say).
  const doorFeat = rb.parts.flatMap(p => p.features).find(f => f.type === 'door' && isVisibleFace(f.face));
  const doorFace = doorFeat ? (doorFeat.face ?? 'south') as WallFace : null;
  const windows = countVisible(rb, 'window');
  const dormers = countVisible(rb, 'dormer');
  const vents = visibleVents(rb);

  const clauses: string[] = [`a ${plan} ${plural(levels, 'storey')} structure with ${roofPhrase(roof)}`];
  // Generalized (TTI): keep identity-defining structure (plan/storeys/roof + which features are
  // PRESENT) but drop the exact counts of incidental features, so the model chooses how many
  // chimneys/windows/dormers to draw. Faithful (img2img) keeps the exact counts to match our massing.
  for (const v of vents) clauses.push(gen ? ventPhraseGeneralized(v.kind, era) : ventPhrase(v.kind, v.count, era));
  if (windows) clauses.push(gen ? 'windows' : plural(windows, 'visible window'));
  if (dormers) clauses.push(gen ? 'roof dormers' : plural(dormers, 'roof dormer'));
  // Non-body structural parts carry the craft identity — a bakehouse's bread oven, a smithy's
  // forge, a brewhouse's oast kiln. They're PARTS (not features), so the feature loops above miss
  // them; describe each by its brief so the model actually draws the building's tell.
  const STRUCTURAL_PARTS = new Set(['furnace']);
  const partCtx = { materials: rb.materials, footprint: rb.footprint };
  for (const p of rb.parts) {
    if (!STRUCTURAL_PARTS.has(p.type)) continue;
    try { const brief = getPartType(p.type).toBrief(p, partCtx); if (brief) clauses.push(brief); } catch { /* skip unbriefable part */ }
  }
  if (doorFace) clauses.push(`a ${gen ? 'wooden door' : `single wooden door on ${FACE_ISO[doorFace]}`}`);

  return gen
    ? `It is ${clauses.join(', ')}.`
    : `It is ${clauses.join(', ')}. Draw only these visible elements and leave the hidden rear walls bare.`;
}

/** Wall/roof materials off the compiled building prim (for the TTI subject clause). */
function walledMaterials(rb: ResolvedBlueprint): { wall?: Mat; roof?: Mat } {
  const b = toGeometry(rb).parts.find((p) => p.prim === 'building');
  return b && b.prim === 'building' ? { wall: b.wallMat, roof: b.roofMat } : {};
}

/** The pure TEXT-TO-IMAGE reference prompt for a subject: real subject + GENERALIZED geometry
 *  (identity kept, incidental counts dropped) in the target pixel-art style, with NO img2img
 *  scaffolding (no repaint/chroma/colour-legend clauses). The single source used by the studio's
 *  reference regen and the tti-probe CLI. */
export function ttiReferencePrompt(rb: ResolvedBlueprint): string {
  const desc = descriptorPhrase(rb.descriptors);
  const era = rb.era ?? 'medieval';
  const noun = (rb.preset ?? rb.category ?? 'building').replace(/_(small|large|tiny|big)$/, '').replace(/_/g, ' ');
  const { wall, roof } = walledMaterials(rb);
  const mat = [wall ? `${wall} walls` : '', roof ? `a ${roof} roof` : ''].filter(Boolean).join(' and ');
  const subject = `${desc ? desc + ' ' : ''}${era} ${noun}${mat ? ` with ${mat}` : ''}`;
  const geom = geometryDescription(rb, { generalized: true });
  return [
    `A crisp 2D isometric pixel-art game sprite (2:1 perspective) of a ${subject}.`,
    geom,
    `Even ambient lighting, plain background, no ground shadow.`,
  ].filter(Boolean).join(' ');
}

/** Map an OpenRouter image model id to its prompt family. */
export function imageModelFamily(model: string): ImageModelFamily {
  const m = model.toLowerCase();
  if (m.includes('gemini')) return 'gemini';            // check first: gemini ids also contain "-image"
  if (m.includes('gpt') || m.startsWith('openai/')) return 'openai';
  if (m.includes('flux') || m.includes('black-forest')) return 'flux';
  return 'generic';
}

/** Subject line — era + descriptor + the real noun, with its true wall/roof materials
 *  (artistic identity). Geometry detail lives in geometryDescription, not here, so the
 *  subject stays a clean noun phrase. */
function describeSubject(rb: ResolvedBlueprint): string {
  const spec = toGeometry(rb);
  const desc = descriptorPhrase(rb.descriptors);
  const descPrefix = desc ? `${desc} ` : '';
  const era = rb.era ?? 'medieval';
  const stage = stagePhrase(rb.class, rb.stage);     // 'a burnt-out ruin of' etc. (replaces the article)
  const noun = subjectNoun(rb);
  const lead = stage || 'a';

  if (isWalledBuilding(spec)) {
    const mat = walledMaterialClause(spec);
    return `${lead} ${descPrefix}${era} ${noun}${mat ? ` with ${mat}` : ''}`;
  }
  // Open frame / prop: prefer a part phrase that already names the subject.
  const phrases = partPhrases(rb);
  const richer = phrases.find(p => p.toLowerCase().includes(noun.toLowerCase()));
  if (richer) return `${lead} ${descPrefix}${era} ${richer.replace(/^an?\s+/i, '')}`;
  return `${lead} ${descPrefix}${era} ${noun}`;
}

/** Agent customisation woven into the prompt: preferred final colours (`palette`, hex
 *  bound to the named region per FLUX) + free-text art direction (`notes`). Both persist
 *  on the resolved blueprint, so a customised variant has its own cache identity. */
function customization(rb: ResolvedBlueprint): string {
  const bits: string[] = [];
  const pal = rb.palette;
  if (pal && (pal.walls || pal.roof || pal.trim)) {
    const cols = [
      pal.walls ? `the walls are ${pal.walls}` : '',
      pal.roof ? `the roof is ${pal.roof}` : '',
      pal.trim ? `the trim is ${pal.trim}` : '',
    ].filter(Boolean).join(', ');
    bits.push(`Final colours: ${cols}.`);
  }
  if (rb.notes) bits.push(`Art direction: ${rb.notes}.`);
  return bits.join(' ');
}

// The ONE irreducible pipeline contract (not asset-specific, kept terse): a flat
// chroma background we key out ourselves (chroma-key.ts) — we DEMAND a solid magenta
// fill rather than trusting the model to emit alpha (it bakes it opaque half the time).
// Stated POSITIVELY (FLUX ignores negatives) and the init image already IS this magenta.
const BACKGROUND =
  `Set the entire background to solid magenta #FF00FF (RGB ${CHROMA_RGB.join(',')}), ` +
  `exactly as in the reference, and keep magenta off the structure.`;

// The sprite is a PBR ALBEDO: the engine re-lights it with the geometry's normals + a
// directional sun, so the painting itself must be FLAT — bake no light. A sprite painted
// with its own hard sun gets shaded twice (a harsh dark band on the shadowed faces). Ask
// for even, ambient, shadeless colour; the engine supplies all the form and shadow.
const FLAT_ALBEDO =
  `Use flat, even, ambient lighting only — paint local material colour with no baked cast ` +
  `shadows, no strong directional sun and no darkened sides; the game engine adds the lighting.`;

// The edit verb per family. FLUX/OpenAI take an i2i "repaint the reference" instruction;
// gemini phrases it as "redraw the attached reference".
const EDIT_VERB: Record<ImageModelFamily, string> = {
  flux: 'Repaint the attached colour-coded massing render as',
  openai: 'Repaint the attached colour-coded reference as',
  gemini: 'Using the attached colour-coded massing render as the structural reference, redraw it as',
  generic: 'Redraw the attached colour-coded reference as',
};

/**
 * The img2img prompt for `rb` targeting `model`. Subject-first, an EDIT instruction
 * that names what to preserve, every other clause earned by this asset's geometry —
 * no fixed preamble, no filler. ~50–75 words for a typical building.
 */
export function buildingImagePrompt(rb: ResolvedBlueprint, model: string): string {
  const spec = toGeometry(rb);
  const family = imageModelFamily(model);
  const subject = describeSubject(rb);
  const geom = geometryDescription(rb);
  const legend = referenceKey(presentMaterials(spec));
  const custom = customization(rb);

  // The silhouette-adherence clause is subject-appropriate: a walled building must
  // keep its eaves in the outline and match its roof pitch; a tree, rock or open
  // frame has no walls/eaves/roof, so it just stays within its outline.
  const walled = (rb.class === 'building' || rb.class === 'prop') && isWalledBuilding(spec);
  const within = walled
    ? `Keep the whole building — walls and roof eaves alike — within the reference's ` +
      `coloured outline, matching its silhouette, footprint and roof pitch.`
    : `Keep the whole subject within the reference's coloured outline, matching its ` +
      `silhouette and footprint.`;

  // Subject leads (word order is weighted); then the edit verb + output style with the
  // single preservation clause; the real geometry; the colour map; customisation; one
  // short richness cue; the background contract. No generic filler.
  return [
    `${subject} — ${EDIT_VERB[family]} a crisp 2D isometric pixel-art game sprite ` +
      `(2:1 perspective). ${within}`,
    geom,
    legend,
    `Place each material in its reference region, then render rich textures and period weathering.`,
    custom,
    FLAT_ALBEDO,
    BACKGROUND,
  ].filter(Boolean).join(' ');
}
