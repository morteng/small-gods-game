// src/assetgen/npc-image-prompt.ts
// Deterministic img2img prompt for NPC sprite frames — the character half of
// what building-image-prompt.ts does for structures, and shaped by the one way
// the two jobs genuinely differ.
//
// A building init is GREY MASSING: the model is told what the shapes mean
// (a colour legend binding hex to material) and asked to invent a surface. An
// NPC init is a FINISHED 64px character in the project's own palette, already
// posed, already outlined, already shaded. Nothing needs decoding, so there is
// no legend; the model is being asked to REDRESS someone we already drew. That
// makes the preservation clause the load-bearing sentence rather than a
// caveat — the pose, the limb positions and the outline are the animation, and
// a model that "improves" them has destroyed the thing being generated.
//
// Same grounding as the building prompt (Black Forest Labs' FLUX img2img
// guidance): natural language, subject-first, an edit instruction that names
// what changes AND what to preserve, positive-only phrasing, hex bound to the
// named object. Everything asserted is a fact the caller supplied about this
// subject — no fixed filler, no "masterpiece, highly detailed".
//
// Pure function of (subject, clip, facing, model) → safe to fold into a cache
// key, which is exactly what the seeder does with it.
import { CHROMA_RGB } from '@/render/chroma-key';
import { imageModelFamily, type ImageModelFamily } from './building-image-prompt';

/** Who this sheet is of. Every field is stated by the caller and lands in the
 *  prompt verbatim-ish — nothing here is inferred, so a manifest row can be
 *  read back as the description that produced it. */
export interface NpcSubject {
  /** Stable id — part of the library key, so it must not drift with wording. */
  id: string;
  /** Noun phrase, article included: 'an acolyte of the drowned god'. */
  name: string;
  /** Garments and gear, most prominent first. Rendered as a list. */
  wears: readonly string[];
  /** Optional held items. Named separately because a held object is the one
   *  thing that can legitimately change the silhouette, and the rig cannot
   *  supply one — a prop must already be in the init (see `attachment.ts`) or
   *  it must not be asked for. Anything listed here is described as ALREADY
   *  PRESENT in the reference, never as something to add. */
  holds?: readonly string[];
  /** Free note for anything the fields above cannot carry. */
  note?: string;
}

/** How the figure is posed in this sheet. Keyed by clip name; an unknown clip
 *  falls back to a neutral phrase rather than guessing a motion, because a
 *  wrong action word actively fights the init image. */
const ACTION_PHRASE: Record<string, string> = {
  walk: 'mid-stride, walking',
  'walk-brisk': 'mid-stride, walking briskly',
  march: 'mid-stride, marching in step',
  wave: 'raising one arm to wave',
  'pray-raise': 'raising both arms in prayer',
  'idle-shift': 'standing at ease',
};

/** What the camera sees. The rig bakes three distinct facings and the fourth is
 *  a mirror; a model told nothing about facing will happily paint a face onto
 *  the back of a head. */
const FACING_PHRASE: Record<string, string> = {
  down: 'seen from the front',
  up: 'seen from behind',
  left: 'seen from the side, facing left',
  right: 'seen from the side, facing right',
};

const CHROMA_HEX = `#${CHROMA_RGB.map((c) => c.toString(16).padStart(2, '0')).join('')}`;

// The engine lights the scene; a sprite carrying its own baked sun would be lit
// twice and would contradict the ambient it is drawn into. Same contract as
// buildings, same sentence, for the same reason.
const FLAT_ALBEDO =
  'Use flat, even, ambient lighting — local colour only, no cast shadows and no strong directional sun; ' +
  'the game engine adds the lighting.';

const BACKGROUND = `Fill the entire background with solid uniform ${CHROMA_HEX} magenta, edge to edge.`;

// The edit verb per family, adapted to a subject that is already drawn. Note
// what is NOT said: nothing calls the reference a "massing render" or a
// "colour-coded" anything, because for a character it is neither — telling a
// model that finished art is a placeholder invites it to replace the art.
const EDIT_VERB: Record<ImageModelFamily, string> = {
  flux: 'Repaint the attached character sprite as',
  openai: 'Repaint the attached character reference as',
  gemini: 'Using the attached character sprite as the reference, redraw it as',
  qwen: 'Repaint the attached character sprite as',
  generic: 'Redraw the attached character reference as',
};

// Qwen-Image-Edit follows an explicit change-this-keep-that contract far more
// literally than a diffusion i2i pass — the building pilot measured IoU
// 0.974–0.994 against a 0.80 baseline on exactly this kind of final clause. The
// nouns are the character's, not a building's: what must survive here is the
// skeleton, because the skeleton IS the animation.
const QWEN_ADHERENCE =
  'Change clothing and colour only: keep the exact pose, limb positions, proportions, ' +
  'head size and outline of the input image unchanged, and keep the background pure magenta.';

/** Everything the prompt is built from. `frame`/`frames` are carried so a sheet
 *  can say where in the cycle this pose sits — a model shown one frame of a
 *  stride has no way to know it is one of seventeen. */
export interface NpcPromptContext {
  subject: NpcSubject;
  clip: string;
  facing: string;
  model: string;
  frame?: number;
  frames?: number;
}

/**
 * The img2img prompt for one frame. Subject-first, edit instruction with the
 * preservation clause, then the facts the caller supplied — typically 45–70
 * words.
 */
export function npcImagePrompt(ctx: NpcPromptContext): string {
  const { subject, clip, facing, model } = ctx;
  const family = imageModelFamily(model);
  const action = ACTION_PHRASE[clip] ?? 'in the pose shown';
  const facingPhrase = FACING_PHRASE[facing] ?? 'as shown';

  const wears = subject.wears.length > 0 ? `Wearing ${listPhrase(subject.wears)}.` : '';
  // Held items are described as already there. A model asked to ADD a staff
  // adds it outside the silhouette, which then fails the IoU gate — so the
  // prompt only ever acknowledges what the init already contains.
  const holds = subject.holds?.length ? `The ${listPhrase(subject.holds)} already in the figure's hands stays exactly where it is.` : '';
  // Cycle position, only when the caller knows it. A sheet's frames differ by a
  // fraction of a stride, and saying so is the one textual lever we have
  // against per-frame drift on backends that ignore the seed.
  const cycle = ctx.frame !== undefined && ctx.frames !== undefined && ctx.frames > 1
    ? `This is frame ${ctx.frame + 1} of ${ctx.frames} in a single continuous animation cycle — all frames show the same character in identical clothing.`
    : '';

  return [
    `${subject.name}, ${action}, ${facingPhrase} — ${EDIT_VERB[family]} a crisp 2D pixel-art game sprite. ` +
      `Keep the figure's pose, proportions and outline exactly as in the reference.`,
    wears,
    holds,
    subject.note ?? '',
    cycle,
    FLAT_ALBEDO,
    BACKGROUND,
    family === 'qwen' ? QWEN_ADHERENCE : '',
  ].filter(Boolean).join(' ');
}

/** 'a, b and c' — Oxford-free, because the model is not a copy editor. */
function listPhrase(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}
