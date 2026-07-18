/**
 * LPC humanoid paper-doll template — chips + joints read off the vendored
 * Universal LPC character sheets (64px cells), south facing, authored against
 * the walk sheet's column-0 idle stand (`LPC_ANIMATIONS.walk` reserves col 0).
 *
 * Joint coordinates were measured on the composed male base + longsleeve +
 * head/face/hair stack (see `scripts/paperdoll-inspect.ts` for the gridded
 * reference render). All wardrobe layers conform to the same template body, so
 * one chip set drives every layer — that conformance IS the LPC contract.
 *
 * Facing note: these rects/pivots are for the SOUTH (down) rows only. Other
 * facings need their own chip sets (side views overlap arms over torso).
 */
import type { AnimTemplate, Clip } from './rig';
import type { StampRef } from './stamp';

/** One vendored LPC layer + optional whole-layer chip assignment. */
export interface HumanoidLayerSpec {
  /** Path relative to `public/`. */
  path: string;
  /** Chip this layer follows wholesale (head/face/hair ride the head bone). */
  assign?: string;
}

/** Source cell the chips are authored against: walk sheet, col 0 (idle), south row. */
export const HUMANOID_SOURCE = { anim: 'walk', col: 0, row: 2 } as const;

// Joints (cell coords, y-down): shoulders, elbows, neck, hips, knees. Elbows
// and knees sit on the LIMB COLUMN's centerline, not the rect's inner edge — a
// pivot at the torso seam makes the segment orbit instead of hinge. Tune live
// with the studio's joint pin mode; verify with scripts/paperdoll-inspect.ts.
const SHOULDER_L: [number, number] = [26, 37];
const ELBOW_L: [number, number] = [19, 44];
const SHOULDER_R: [number, number] = [39, 37];
const ELBOW_R: [number, number] = [44, 44];
const NECK: [number, number] = [32, 34];
const HIP_L: [number, number] = [25, 51];
const KNEE_L: [number, number] = [24, 56];
const HIP_R: [number, number] = [38, 51];
const KNEE_R: [number, number] = [39, 56];

/**
 * South-facing humanoid template. Root (index 0) is the whole cell; every
 * other chip's rect is cleared from it at render time, so limbs lift cleanly.
 * "L"/"R" are SCREEN left/right (the character's right/left arm respectively).
 */
export const LPC_HUMANOID_SOUTH: AnimTemplate = {
  name: 'lpc-humanoid-south',
  cell: 64,
  chips: [
    { name: 'trunk', rect: { x: 0, y: 0, w: 64, h: 64 }, pivot: [32, 49], parent: -1, z: 0 },
    // Head stops above the collar (y32) so tilting doesn't drag shoulder pixels.
    // Top z: the LPC compositor paints head/face/hair LAST, so the head chip
    // must render in front of the arms (a bowed chin sits over the chest).
    { name: 'head', rect: { x: 21, y: 11, w: 22, h: 21 }, pivot: NECK, parent: 0, z: 10 },
    // Arm rects hug the sleeve columns and stop OUTSIDE the dark underarm seam
    // (seam + sleeve cap stay with the trunk — cut-out rigging convention).
    // Wider boxes here scoop chest pixels that smear across rotation.
    { name: 'armL_up', rect: { x: 15, y: 33, w: 9, h: 12 }, pivot: SHOULDER_L, parent: 0, z: 2 },
    { name: 'armL_fore', rect: { x: 15, y: 42, w: 9, h: 9 }, pivot: ELBOW_L, parent: 2, z: 3 },
    { name: 'armR_up', rect: { x: 40, y: 33, w: 9, h: 12 }, pivot: SHOULDER_R, parent: 0, z: 4 },
    { name: 'armR_fore', rect: { x: 40, y: 42, w: 9, h: 9 }, pivot: ELBOW_R, parent: 4, z: 5 },
    // Legs start BELOW the tunic hem (y51) so thigh swings don't tear the skirt;
    // the fore chips take the whole boot flare (widest rows are the feet).
    // Front-view caveat: big leg poses (kneel/sit) are OUT-OF-PLANE here — legs
    // only carry in-plane accents (weight shift, buckle) on the south facing.
    { name: 'legL_up', rect: { x: 22, y: 51, w: 8, h: 5 }, pivot: HIP_L, parent: 0, z: 6 },
    { name: 'legL_fore', rect: { x: 19, y: 56, w: 11, h: 6 }, pivot: KNEE_L, parent: 6, z: 7 },
    { name: 'legR_up', rect: { x: 34, y: 51, w: 8, h: 5 }, pivot: HIP_R, parent: 0, z: 8 },
    { name: 'legR_fore', rect: { x: 34, y: 56, w: 11, h: 6 }, pivot: KNEE_R, parent: 8, z: 9 },
  ],
};

/**
 * Open-palm hand stamps (screen L then R) — spread-open hands harvested from
 * the spellcast sheet's south row, col 6 (palms hanging open down-out). That
 * donor matches the rest fist's fingers-DOWN orientation, so applying it
 * pre-FK lets the chip rotation carry the palm to fingers-up on a raise —
 * col 5's up-pointing palm would arrive inverted. Crops are hand-only (the
 * longsleeve cuff ends a row above, so in the default stack only the body
 * layer contributes pixels); clear rects excise the rest fists exactly —
 * (23,50)/(40,50) are leg-top pixels and must survive.
 */
export const STAMP_PALMS_OPEN: readonly StampRef[] = [
  {
    anim: 'spellcast',
    col: 6,
    row: 2,
    crop: { x: 15, y: 44, w: 8, h: 5 },
    dest: [16, 45],
    clear: [
      { x: 17, y: 45, w: 7, h: 5 },
      { x: 19, y: 50, w: 4, h: 1 },
    ],
  },
  {
    anim: 'spellcast',
    col: 6,
    row: 2,
    crop: { x: 41, y: 44, w: 8, h: 5 },
    dest: [40, 45],
    clear: [
      { x: 40, y: 45, w: 7, h: 5 },
      { x: 41, y: 50, w: 4, h: 1 },
    ],
  },
];

/**
 * Fingers-up open palms for SWEPT-UP arms (pray-raise, ecstatic). A pre-FK
 * palm rotated ~130° smears its 1px fingers into noise, so this pairs two
 * mechanisms: zero-crop ERASER refs strip the rest fists before FK (nothing
 * left to smear at the arm tip), then ANCHORED refs paste spellcast col 5's
 * raised open hands — already fingers-up in the donor — at the FK-carried
 * fist position, axis-aligned and pixel-perfect. Eraser clear rects = the
 * exact fist rects from STAMP_PALMS_OPEN.
 */
export const STAMP_PALMS_SKY: readonly StampRef[] = [
  { self: true, crop: { x: 0, y: 0, w: 0, h: 0 }, dest: [0, 0], clear: [
    { x: 17, y: 45, w: 7, h: 5 },
    { x: 19, y: 50, w: 4, h: 1 },
  ] },
  { self: true, crop: { x: 0, y: 0, w: 0, h: 0 }, dest: [0, 0], clear: [
    { x: 40, y: 45, w: 7, h: 5 },
    { x: 41, y: 50, w: 4, h: 1 },
  ] },
  // Anchored palms: dest centers on the rest fist; the forearm chip's world
  // transform carries that center to the raised arm tip each frame.
  { anim: 'spellcast', col: 5, row: 2, crop: { x: 8, y: 22, w: 8, h: 7 }, dest: [17, 44], anchor: 'armL_fore' },
  { anim: 'spellcast', col: 5, row: 2, crop: { x: 48, y: 22, w: 8, h: 7 }, dest: [40, 44], anchor: 'armR_fore' },
];

/**
 * Facial stamps — SELF-CLONE refs (no expression sheets are vendored, so each
 * layer donates to itself; see StampRef.self). Feature map, pixel-recon'd from
 * the rest cell: eyes are 4×3 blocks at rows 29–31, x26–29 (screen-L) and
 * x34–37; row 32 below them is clean skin; (27,29)/(35,29) are the dark eye
 * outline inks. Layers with nothing in these rects (hair, clothes, headless
 * body) no-op, so the stamps compose across wardrobe like the hand stamps do.
 */

/** Eyes closed: skin cloned over each eye + a 2px lash line from the eye ink. */
export const STAMP_BLINK: readonly StampRef[] = [
  // Left eye: skin row 32 cloned up over rows 29–31, then the lash.
  { self: true, crop: { x: 26, y: 32, w: 4, h: 1 }, dest: [26, 29] },
  { self: true, crop: { x: 26, y: 32, w: 4, h: 1 }, dest: [26, 30] },
  { self: true, crop: { x: 26, y: 32, w: 4, h: 1 }, dest: [26, 31] },
  { self: true, crop: { x: 27, y: 29, w: 2, h: 1 }, dest: [27, 30] },
  // Right eye.
  { self: true, crop: { x: 34, y: 32, w: 4, h: 1 }, dest: [34, 29] },
  { self: true, crop: { x: 34, y: 32, w: 4, h: 1 }, dest: [34, 30] },
  { self: true, crop: { x: 34, y: 32, w: 4, h: 1 }, dest: [34, 31] },
  { self: true, crop: { x: 35, y: 29, w: 2, h: 1 }, dest: [35, 30] },
];

/** Mouth open: 2px of eye-outline ink under the nose (the rest face has none). */
export const STAMP_MOUTH_OPEN: readonly StampRef[] = [
  { self: true, crop: { x: 27, y: 29, w: 2, h: 1 }, dest: [31, 33] },
];

/** Raise-arms supplication: stand → arms swept up toward the sky, face lifted. */
export const CLIP_PRAY_RAISE: Clip = {
  name: 'pray-raise',
  frames: 7,
  // Palms spread open to the sky as the arms sweep past horizontal (anchored —
  // pasted post-FK at the arm tip, so the fingers stay crisp).
  stamps: [{ t: 0.7, refs: STAMP_PALMS_SKY }],
  tracks: {
    // Front view: pitch is faked with translation — the head LIFTS (dy<0),
    // never rotates (in-plane rotation reads as a sideways ear-to-shoulder tilt).
    head: [
      { t: 0, deg: 0, dy: 0 },
      { t: 1, deg: 0, dy: -2 },
    ],
    // Overshoot-and-settle: the sweep carries past the mark, then eases back.
    armL_up: [
      { t: 0, deg: 0 },
      { t: 0.75, deg: 114 },
      { t: 1, deg: 108 },
    ],
    armL_fore: [
      { t: 0, deg: 0 },
      { t: 0.75, deg: 24 },
      { t: 1, deg: 20 },
    ],
    armR_up: [
      { t: 0, deg: 0 },
      { t: 0.75, deg: -114 },
      { t: 1, deg: -108 },
    ],
    armR_fore: [
      { t: 0, deg: 0 },
      { t: 0.75, deg: -24 },
      { t: 1, deg: -20 },
    ],
  },
};

/** Head-bowed clasp: a quieter, habitual devotion (contrast with pray-raise). */
export const CLIP_PRAY_BOW: Clip = {
  name: 'pray-bow',
  frames: 7,
  // The legs take the bow: knees splay a touch as the head drops (head dy is
  // the only pitch signal on a front view), shins counter to keep feet flat —
  // and the soles are PLANTED (the counter cancels rotation, not the knee
  // point's arc, so without the plant the boots slide a pixel).
  couple: [
    { from: 'head', prop: 'dy', to: 'legL_up', gain: 1, lag: 0.08 },
    { from: 'head', prop: 'dy', to: 'legL_fore', gain: -1, lag: 0.08 },
    { from: 'head', prop: 'dy', to: 'legR_up', gain: -1, lag: 0.08 },
    { from: 'head', prop: 'dy', to: 'legR_fore', gain: 1, lag: 0.08 },
  ],
  plant: [
    { chip: 'legL_fore', point: [24.5, 62] },
    { chip: 'legR_fore', point: [39.5, 62] },
  ],
  tracks: {
    // Chin tuck = translate down; no rotation (see pray-raise note).
    head: [
      { t: 0, deg: 0, dy: 0 },
      { t: 1, deg: 0, dy: 3 },
    ],
    armL_up: [
      { t: 0, deg: 0 },
      { t: 1, deg: -38 },
    ],
    armL_fore: [
      { t: 0, deg: 0 },
      { t: 1, deg: -52 },
    ],
    armR_up: [
      { t: 0, deg: 0 },
      { t: 1, deg: 38 },
    ],
    armR_fore: [
      { t: 0, deg: 0 },
      { t: 1, deg: 52 },
    ],
  },
};

/** Deep contrite bow: heavy chin tuck, hands clasped high and tight. */
export const CLIP_PRAY_PENITENT: Clip = {
  name: 'pray-penitent',
  frames: 8,
  // Deeper bow, deeper buckle — same planted-feet knee splay as pray-bow, and
  // the eyes close as the head sinks (contrition is read with the face, too).
  couple: [
    { from: 'head', prop: 'dy', to: 'legL_up', gain: 0.8, lag: 0.08 },
    { from: 'head', prop: 'dy', to: 'legL_fore', gain: -0.8, lag: 0.08 },
    { from: 'head', prop: 'dy', to: 'legR_up', gain: -0.8, lag: 0.08 },
    { from: 'head', prop: 'dy', to: 'legR_fore', gain: 0.8, lag: 0.08 },
  ],
  plant: [
    { chip: 'legL_fore', point: [24.5, 62] },
    { chip: 'legR_fore', point: [39.5, 62] },
  ],
  stamps: [{ t: 0.6, refs: STAMP_BLINK }],
  tracks: {
    // The head drops heavy — sinks past the mark, then settles up a pixel.
    head: [
      { t: 0, deg: 0, dy: 0 },
      { t: 0.7, deg: 0, dy: 6 },
      { t: 1, deg: 0, dy: 5 },
    ],
    armL_up: [
      { t: 0, deg: 0 },
      { t: 1, deg: -30 },
    ],
    armL_fore: [
      { t: 0, deg: 0 },
      { t: 1, deg: -74 },
    ],
    armR_up: [
      { t: 0, deg: 0 },
      { t: 1, deg: 30 },
    ],
    armR_fore: [
      { t: 0, deg: 0 },
      { t: 1, deg: 74 },
    ],
  },
};

/**
 * Ecstatic supplication: arms thrown full up, then a held sway. The only clip
 * with mid-keys so far — arms overshoot, settle, and re-reach while the lifted
 * head drifts side to side (dx — the head chip carries the whole-head layers).
 */
export const CLIP_PRAY_ECSTATIC: Clip = {
  name: 'pray-ecstatic',
  frames: 12,
  // Hands burst open as the arms sweep past horizontal (step-switch: the
  // one-frame fist→palm pop reads as the hands opening; anchored refs keep
  // the fingers crisp at full raise).
  stamps: [{ t: 0.15, refs: STAMP_PALMS_SKY }],
  // Reverse-IK touch: the trunk sway drives a LAGGED knee flex — thighs lean
  // the knees into the sway, shins counter most of it a beat late, so the legs
  // read as absorbing the sway instead of rigidly counter-sliding under it.
  // Soles are planted; the partial shin counter still rolls the boot about
  // its planted sole point (heel-toe weight roll).
  couple: [
    { from: 'trunk', prop: 'dx', to: 'legL_up', gain: -6, lag: 0.06 },
    { from: 'trunk', prop: 'dx', to: 'legL_fore', gain: 4, lag: 0.12 },
    { from: 'trunk', prop: 'dx', to: 'legR_up', gain: -6, lag: 0.06 },
    { from: 'trunk', prop: 'dx', to: 'legR_fore', gain: 4, lag: 0.12 },
    // Follow-through: the lifted head trails the sway a beat (it rides the
    // trunk as a child, so this is EXTRA drift on top — overshoots outward at
    // each reversal, the classic loose-head feel).
    { from: 'trunk', prop: 'dx', to: 'head', toProp: 'dx', gain: 0.8, lag: 0.1 },
  ],
  plant: [
    { chip: 'legL_fore', point: [24.5, 62] },
    { chip: 'legR_fore', point: [39.5, 62] },
  ],
  tracks: {
    // The sway lives on the TRUNK (head, arms and torso ride it) while the
    // legs counter-translate to stay planted — same planted-feet trick as
    // idle-shift, so the whole upper body rocks, not just the head.
    trunk: [
      { t: 0.4, deg: 0, dx: 0 },
      { t: 0.7, deg: 0, dx: -1 },
      { t: 1, deg: 0, dx: 1 },
    ],
    head: [
      { t: 0, deg: 0, dy: 0 },
      { t: 0.4, deg: 0, dy: -3 },
      { t: 1, deg: 0, dy: -3 },
    ],
    armL_up: [
      { t: 0, deg: 0 },
      { t: 0.4, deg: 116 },
      { t: 0.7, deg: 104 },
      { t: 1, deg: 114 },
    ],
    armL_fore: [
      { t: 0, deg: 0 },
      { t: 0.4, deg: 24 },
      { t: 1, deg: 16 },
    ],
    armR_up: [
      { t: 0, deg: 0 },
      { t: 0.4, deg: -116 },
      { t: 0.7, deg: -104 },
      { t: 1, deg: -114 },
    ],
    armR_fore: [
      { t: 0, deg: 0 },
      { t: 0.4, deg: -24 },
      { t: 1, deg: -16 },
    ],
    legL_up: [
      { t: 0.4, deg: 0, dx: 0 },
      { t: 0.7, deg: 0, dx: 1 },
      { t: 1, deg: 0, dx: -1 },
    ],
    legR_up: [
      { t: 0.4, deg: 0, dx: 0 },
      { t: 0.7, deg: 0, dx: 1 },
      { t: 1, deg: 0, dx: -1 },
    ],
  },
};

/** Despair slump: head drops heavy, arms fall slightly out, palms helpless. */
export const CLIP_DESPAIR: Clip = {
  name: 'despair',
  frames: 8,
  // Mid-slump the fists fall open — the helpless empty-palm beat — then the
  // eyes close as the slump bottoms out (grief lands on the face last).
  stamps: [
    { t: 0.5, refs: STAMP_PALMS_OPEN },
    { t: 0.78, refs: [...STAMP_PALMS_OPEN, ...STAMP_BLINK] },
  ],
  // Shin counter-rotation derived from the thigh (was hand-keyed −1× tracks):
  // full cancellation keeps the feet FLAT; the plant nails the soles too.
  couple: [
    { from: 'legL_up', prop: 'deg', to: 'legL_fore', gain: -1 },
    { from: 'legR_up', prop: 'deg', to: 'legR_fore', gain: -1 },
  ],
  plant: [
    { chip: 'legL_fore', point: [24.5, 62] },
    { chip: 'legR_fore', point: [39.5, 62] },
  ],
  tracks: {
    // Head drops past the slump point, then settles — dead weight, not a lower.
    head: [
      { t: 0, deg: 0, dy: 0 },
      { t: 0.7, deg: 0, dy: 5 },
      { t: 1, deg: 0, dy: 4 },
    ],
    armL_up: [
      { t: 0, deg: 0 },
      { t: 0.7, deg: 20 },
      { t: 1, deg: 18 },
    ],
    armL_fore: [
      { t: 0, deg: 0 },
      { t: 1, deg: 12 },
    ],
    armR_up: [
      { t: 0, deg: 0 },
      { t: 0.7, deg: -20 },
      { t: 1, deg: -18 },
    ],
    armR_fore: [
      { t: 0, deg: 0 },
      { t: 1, deg: -12 },
    ],
    // Knee buckle: thighs splay outward, shins follow via the couple above —
    // legs giving way under the slump, a few degrees only.
    legL_up: [
      { t: 0, deg: 0 },
      { t: 1, deg: 5 },
    ],
    legR_up: [
      { t: 0, deg: 0 },
      { t: 1, deg: -5 },
    ],
  },
};

/**
 * Weight-shift idle: torso (with head and arms) sways onto the screen-left leg
 * while both legs counter-translate to stay planted. Pure translation — no
 * rotation, so every baked frame stays pixel-exact (no supersample blending).
 */
export const CLIP_IDLE_SHIFT: Clip = {
  name: 'idle-shift',
  frames: 8,
  // A blink mid-shift. Stamps are pixel swaps, not transforms, so the clip's
  // pixel-exact property survives — still zero rotation, zero AA.
  stamps: [
    { t: 0.45, refs: STAMP_BLINK },
    { t: 0.75, refs: [] },
  ],
  tracks: {
    trunk: [
      { t: 0, deg: 0, dx: 0 },
      { t: 1, deg: 0, dx: -2 },
    ],
    // The chin settles a hair as the weight lands.
    head: [
      { t: 0, deg: 0, dy: 0 },
      { t: 1, deg: 0, dy: 1 },
    ],
    legL_up: [
      { t: 0, deg: 0, dx: 0 },
      { t: 1, deg: 0, dx: 2 },
    ],
    legR_up: [
      { t: 0, deg: 0, dx: 0 },
      { t: 1, deg: 0, dx: 2 },
    ],
  },
};

/**
 * Talking bust: the conversation-card loop. Nearly all face — mouth flaps on a
 * step rhythm with one blink at the midpoint — over a gentle head nod and a
 * breath-like trunk settle. Meant to be cropped to the head for the card, but
 * reads at full frame too.
 */
export const CLIP_CONVERSE: Clip = {
  name: 'converse',
  frames: 12,
  stamps: [
    { t: 0, refs: STAMP_MOUTH_OPEN },
    { t: 0.18, refs: [] },
    { t: 0.32, refs: STAMP_MOUTH_OPEN },
    { t: 0.5, refs: STAMP_BLINK },
    { t: 0.64, refs: STAMP_MOUTH_OPEN },
    { t: 0.82, refs: [] },
  ],
  tracks: {
    // Small affirmative nod (translation — see the pray-raise pitch note).
    head: [
      { t: 0, deg: 0, dy: 0 },
      { t: 0.25, deg: 0, dy: 1 },
      { t: 0.5, deg: 0, dy: 0 },
      { t: 0.75, deg: 0, dy: 1 },
      { t: 1, deg: 0, dy: 0 },
    ],
  },
};

/** Every authored clip, in menu order. */
export const HUMANOID_CLIPS: readonly Clip[] = [
  CLIP_PRAY_RAISE,
  CLIP_PRAY_BOW,
  CLIP_PRAY_PENITENT,
  CLIP_PRAY_ECSTATIC,
  CLIP_DESPAIR,
  CLIP_IDLE_SHIFT,
  CLIP_CONVERSE,
];

/**
 * Default character stack for previews/bakes, painted bottom→top. The LPC body
 * sheet is HEADLESS — skull/face/hair are separate whole-head layers, so they
 * are assigned to the `head` chip wholesale (rect-slicing them cut chins and
 * hair in half at the head-box boundary). Body + clothes stay rect-sliced.
 */
/**
 * Candidate paths for a layer's donor anim sheet, derived from its walk path.
 * Safe because the vendored set mirrors flat-vs-variant layout and variant
 * filenames identically across anim subfolders (verified across the full
 * ROLE_SPECS wardrobe). Variant paths also fall back to the flat sheet, same
 * as the walk loader. Missing donors are fine — the layer keeps rest pixels.
 */
export function donorSheetCandidates(walkPath: string, anim: string): string[] {
  if (walkPath.endsWith('/walk.png')) {
    return [walkPath.slice(0, -'/walk.png'.length) + `/${anim}.png`];
  }
  const m = walkPath.match(/^(.*)\/walk\/([^/]+)$/);
  if (m) return [`${m[1]}/${anim}/${m[2]}`, `${m[1]}/${anim}.png`];
  return [];
}

export const DEFAULT_HUMANOID_LAYERS: readonly HumanoidLayerSpec[] = [
  { path: 'sprites/lpc/spritesheets/body/bodies/male/walk.png' },
  { path: 'sprites/lpc/spritesheets/torso/clothes/longsleeve/longsleeve2_buttoned/male/walk.png' },
  { path: 'sprites/lpc/spritesheets/head/heads/human/male/walk.png', assign: 'head' },
  { path: 'sprites/lpc/spritesheets/head/faces/male/neutral/walk.png', assign: 'head' },
  { path: 'sprites/lpc/spritesheets/hair/plain/adult/walk.png', assign: 'head' },
];
