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

// Joints (cell coords, y-down): shoulders, elbows, neck.
const SHOULDER_L: [number, number] = [26, 37];
const ELBOW_L: [number, number] = [23, 44];
const SHOULDER_R: [number, number] = [39, 37];
const ELBOW_R: [number, number] = [42, 44];
const NECK: [number, number] = [32, 34];

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
    { name: 'head', rect: { x: 21, y: 11, w: 22, h: 21 }, pivot: NECK, parent: 0, z: 1 },
    // Arm rects hug the sleeve columns and stop OUTSIDE the dark underarm seam
    // (seam + sleeve cap stay with the trunk — cut-out rigging convention).
    // Wider boxes here scoop chest pixels that smear across rotation.
    { name: 'armL_up', rect: { x: 15, y: 33, w: 9, h: 12 }, pivot: SHOULDER_L, parent: 0, z: 2 },
    { name: 'armL_fore', rect: { x: 15, y: 42, w: 9, h: 9 }, pivot: ELBOW_L, parent: 2, z: 3 },
    { name: 'armR_up', rect: { x: 40, y: 33, w: 9, h: 12 }, pivot: SHOULDER_R, parent: 0, z: 4 },
    { name: 'armR_fore', rect: { x: 40, y: 42, w: 9, h: 9 }, pivot: ELBOW_R, parent: 4, z: 5 },
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
