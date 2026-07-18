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

/** Raise-arms supplication: stand → arms swept up toward the sky, face lifted. */
export const CLIP_PRAY_RAISE: Clip = {
  name: 'pray-raise',
  frames: 7,
  tracks: {
    // Front view: pitch is faked with translation — the head LIFTS (dy<0),
    // never rotates (in-plane rotation reads as a sideways ear-to-shoulder tilt).
    head: [
      { t: 0, deg: 0, dy: 0 },
      { t: 1, deg: 0, dy: -2 },
    ],
    armL_up: [
      { t: 0, deg: 0 },
      { t: 1, deg: 108 },
    ],
    armL_fore: [
      { t: 0, deg: 0 },
      { t: 1, deg: 20 },
    ],
    armR_up: [
      { t: 0, deg: 0 },
      { t: 1, deg: -108 },
    ],
    armR_fore: [
      { t: 0, deg: 0 },
      { t: 1, deg: -20 },
    ],
  },
};

/** Head-bowed clasp: a quieter, habitual devotion (contrast with pray-raise). */
export const CLIP_PRAY_BOW: Clip = {
  name: 'pray-bow',
  frames: 7,
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
  tracks: {
    head: [
      { t: 0, deg: 0, dy: 0 },
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
  tracks: {
    head: [
      { t: 0, deg: 0, dy: 0 },
      { t: 0.4, deg: 0, dy: -3 },
      { t: 0.7, deg: 0, dx: -1, dy: -3 },
      { t: 1, deg: 0, dx: 1, dy: -3 },
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
  },
};

/** Despair slump: head drops heavy, arms fall slightly out, palms helpless. */
export const CLIP_DESPAIR: Clip = {
  name: 'despair',
  frames: 8,
  tracks: {
    head: [
      { t: 0, deg: 0, dy: 0 },
      { t: 1, deg: 0, dy: 4 },
    ],
    armL_up: [
      { t: 0, deg: 0 },
      { t: 1, deg: 18 },
    ],
    armL_fore: [
      { t: 0, deg: 0 },
      { t: 1, deg: 12 },
    ],
    armR_up: [
      { t: 0, deg: 0 },
      { t: 1, deg: -18 },
    ],
    armR_fore: [
      { t: 0, deg: 0 },
      { t: 1, deg: -12 },
    ],
    // Knee buckle: thighs splay outward while the shins counter-rotate to keep
    // the feet planted — legs giving way under the slump, a few degrees only.
    legL_up: [
      { t: 0, deg: 0 },
      { t: 1, deg: 5 },
    ],
    legL_fore: [
      { t: 0, deg: 0 },
      { t: 1, deg: -5 },
    ],
    legR_up: [
      { t: 0, deg: 0 },
      { t: 1, deg: -5 },
    ],
    legR_fore: [
      { t: 0, deg: 0 },
      { t: 1, deg: 5 },
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

/** Every authored clip, in menu order. */
export const HUMANOID_CLIPS: readonly Clip[] = [
  CLIP_PRAY_RAISE,
  CLIP_PRAY_BOW,
  CLIP_PRAY_PENITENT,
  CLIP_PRAY_ECSTATIC,
  CLIP_DESPAIR,
  CLIP_IDLE_SHIFT,
];

/**
 * Default character stack for previews/bakes, painted bottom→top. The LPC body
 * sheet is HEADLESS — skull/face/hair are separate whole-head layers, so they
 * are assigned to the `head` chip wholesale (rect-slicing them cut chins and
 * hair in half at the head-box boundary). Body + clothes stay rect-sliced.
 */
export const DEFAULT_HUMANOID_LAYERS: readonly HumanoidLayerSpec[] = [
  { path: 'sprites/lpc/spritesheets/body/bodies/male/walk.png' },
  { path: 'sprites/lpc/spritesheets/torso/clothes/longsleeve/longsleeve2_buttoned/male/walk.png' },
  { path: 'sprites/lpc/spritesheets/head/heads/human/male/walk.png', assign: 'head' },
  { path: 'sprites/lpc/spritesheets/head/faces/male/neutral/walk.png', assign: 'head' },
  { path: 'sprites/lpc/spritesheets/hair/plain/adult/walk.png', assign: 'head' },
];
