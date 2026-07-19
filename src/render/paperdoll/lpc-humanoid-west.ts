/**
 * LPC humanoid paper-doll template — WEST facing (LPC row 1, LEFT profile).
 *
 * Profile anatomy differs fundamentally from the south (front) view, so this is
 * a NEW chip layout, not a re-parameterisation of `lpc-humanoid.ts`. In the
 * left profile the character faces LEFT: screen-x LOW = the FRONT of the body
 * (chest, face, forward foot), screen-x HIGH = the BACK. One arm and one leg
 * read as "near" (viewer side, fully drawn); their partners are "far" (mostly
 * occluded by the trunk) and are painted BEHIND it via negative z.
 *
 * Every rect/pivot below was read off the vendored walk sheet's row-1, col-0
 * idle stand with `tmp/west-recon.ts` (ASCII alpha/luma dumps of body-alone,
 * the composed silhouette, and a mid-stride cell). Coordinates are cell space
 * (64px), y-down. The col-0 idle is a mid-swing walk pose — one arm/leg is
 * already forward — which is WHY both legs are separately visible (a clean
 * transparent gap at x30 splits them), a gift for a profile leg rig.
 *
 * Chip names are the fixed profile vocabulary (trunk / head / arm{Near,Far}_
 * {up,fore} / leg{Near,Far}_{up,fore}) so future clip authoring and a
 * facing-agnostic clip mapper can address either template uniformly.
 *
 * Root-clear hazard (profile-specific): `rootChipRaster` clears EVERY non-root
 * chip rect from the trunk. Where a far-limb rect overlaps the torso mass, that
 * clear punches a hole the (behind-trunk) far chip then refills — fine at rest,
 * but a moved far limb vacates the hole and the torso edge shows through. The
 * cure used here: far-arm rects are kept to SLIVERS at the front silhouette
 * edge (x22-25), landing on the transparent gutter and the peeking-hand pixels
 * only, never scooping the opaque torso front edge (which begins at x25-26).
 * The far LEG needs no such care — it sits in its own x31-38 lane, gapped from
 * both the trunk (above row 50) and the near leg (x30 gutter).
 */
import type { AnimTemplate, Clip } from './rig';
import type { Raster } from '../sprite-postprocess';

/** Source cell the chips are authored against: walk sheet, col 0 (idle), WEST row 1. */
export const HUMANOID_WEST_SOURCE = { anim: 'walk', col: 0, row: 1 } as const;

// ── Joints (cell coords, y-down), read off tmp/west-recon.ts ─────────────────
// Profile joint x-positions come from the recon (they are NOT the south x's);
// heights (y) track the south template, which the profile shares.
//
// Near arm = the BACK strip (x37-41), fully detached from the torso below the
// shoulder by a transparent seam at x36 — the clearly-articulable arm.
const SHOULDER_NEAR: [number, number] = [38, 35]; // top of the x37-41 strip @ recon row 35
const ELBOW_NEAR: [number, number] = [39, 42]; //    strip narrows/hand begins @ recon row 42
// Far arm = mostly hidden; only its hand peeks at the FRONT edge (x24, rows 44-47).
// Shoulder is a best-guess sliver on the front edge; elbow sits at the peek.
const SHOULDER_FAR: [number, number] = [24, 36]; // front-edge best guess (occluded upper arm)
const ELBOW_FAR: [number, number] = [24, 43]; //    just above the x24 peeking hand
const NECK: [number, number] = [31, 33]; //          profile jaw/neck join @ recon rows 32-34
// Near (front) leg: thigh x26-30, foot flares forward to x24 (rows 56-59).
const HIP_NEAR: [number, number] = [28, 51];
const KNEE_NEAR: [number, number] = [28, 55];
// Far (back) leg: thigh x31-35, foot at x33-38 (rows 56-60).
const HIP_FAR: [number, number] = [33, 51];
const KNEE_FAR: [number, number] = [35, 55];

/**
 * West-facing humanoid template. Root (index 0) is the whole cell; every other
 * chip's rect is cleared from it at render time. z (ascending = painted first =
 * behind): far arm/leg negative (occluded), trunk 0, near limbs positive, head
 * last (LPC composites head/face/hair on top).
 */
export const LPC_HUMANOID_WEST: AnimTemplate = {
  name: 'lpc-humanoid-west',
  cell: 64,
  chips: [
    { name: 'trunk', rect: { x: 0, y: 0, w: 64, h: 64 }, pivot: [32, 49], parent: -1, z: 0 },
    // Head box = composed silhouette rows 12-33, x21-41 (face in profile). Rides
    // the head/face/hair layers wholesale; z top so a nod sits over the chest.
    { name: 'head', rect: { x: 21, y: 12, w: 21, h: 22 }, pivot: NECK, parent: 0, z: 10 },
    // Near arm — the detached BACK strip x37-41. Upper stops at the elbow (row
    // 42); the fore chip takes the hand. shoulder @ (38,35) per recon (top of
    // the strip), elbow @ (39,42) where the strip narrows to the hand.
    { name: 'armNear_up', rect: { x: 37, y: 34, w: 5, h: 9 }, pivot: SHOULDER_NEAR, parent: 0, z: 3 },
    { name: 'armNear_fore', rect: { x: 37, y: 42, w: 5, h: 8 }, pivot: ELBOW_NEAR, parent: 2, z: 4 },
    // Far arm — occluded upper (best-guess front-edge sliver x23-24, empty in the
    // body raster so its clear scoops nothing) + the peeking hand (x24, rows
    // 44-47) on the fore chip. Both z<0: painted behind the trunk.
    { name: 'armFar_up', rect: { x: 23, y: 35, w: 2, h: 8 }, pivot: SHOULDER_FAR, parent: 0, z: -4 },
    { name: 'armFar_fore', rect: { x: 22, y: 43, w: 3, h: 7 }, pivot: ELBOW_FAR, parent: 4, z: -3 },
    // Near (front) leg — thigh x26-30, foot flares forward. hip @ (28,51), knee
    // @ (28,55) per recon. z>0: in front of the far leg during a scissor.
    { name: 'legNear_up', rect: { x: 26, y: 50, w: 5, h: 6 }, pivot: HIP_NEAR, parent: 0, z: 1 },
    { name: 'legNear_fore', rect: { x: 24, y: 55, w: 7, h: 5 }, pivot: KNEE_NEAR, parent: 6, z: 2 },
    // Far (back) leg — own x31-38 lane, gapped from the near leg at x30. hip @
    // (33,51), knee @ (35,55). z<0: behind the trunk and the near leg.
    { name: 'legFar_up', rect: { x: 31, y: 50, w: 5, h: 6 }, pivot: HIP_FAR, parent: 0, z: -2 },
    { name: 'legFar_fore', rect: { x: 33, y: 55, w: 6, h: 6 }, pivot: KNEE_FAR, parent: 8, z: -1 },
  ],
};

/** The exact chip-name set this template exposes (profile vocabulary). */
export const WEST_CHIP_NAMES = [
  'trunk',
  'head',
  'armNear_up',
  'armNear_fore',
  'armFar_up',
  'armFar_fore',
  'legNear_up',
  'legNear_fore',
  'legFar_up',
  'legFar_fore',
] as const;

/**
 * Rig-articulation TEST clip — NOT a shipped animation. It exercises every
 * moving chip of the profile layout so the bake can prove the rects hinge
 * cleanly (no torso-scoop smear, no far-limb ghosting):
 *
 *  - armNear sweeps forward ~90° (down → pointing LEFT/forward: +deg is CW in
 *    y-down space, so a downward arm rotates to forward) with an elbow bend.
 *  - armFar takes a modest opposite (backward) swing — enough to see the hand
 *    peek move without asserting occluded detail.
 *  - the legs SCISSOR: near swings forward then back while far mirrors it, with
 *    shins counter-rotating via `couple` (−1× the thigh) so they stay roughly
 *    vertical. Soles are deliberately NOT planted — the legs are meant to move,
 *    which is the whole point of the test (plant would fight the scissor).
 */
export const CLIP_WEST_ARTICULATION_TEST: Clip = {
  name: 'west-articulation-test',
  frames: 8,
  couple: [
    // Shin counters thigh so the lower leg stays upright through the scissor.
    { from: 'legNear_up', prop: 'deg', to: 'legNear_fore', gain: -1 },
    { from: 'legFar_up', prop: 'deg', to: 'legFar_fore', gain: -1 },
  ],
  tracks: {
    // Near arm: raise forward, hold near the top with a touch of settle.
    armNear_up: [
      { t: 0, deg: 0 },
      { t: 0.5, deg: 90 },
      { t: 1, deg: 80 },
    ],
    armNear_fore: [
      { t: 0, deg: 0 },
      { t: 0.5, deg: 35 },
      { t: 1, deg: 30 },
    ],
    // Far arm: modest backward counter-swing (the hand peek slides).
    armFar_up: [
      { t: 0, deg: 0 },
      { t: 1, deg: -35 },
    ],
    armFar_fore: [
      { t: 0, deg: 0 },
      { t: 1, deg: -15 },
    ],
    // Leg scissor: near forward→back, far the mirror. Shins follow via couple.
    legNear_up: [
      { t: 0, deg: 0 },
      { t: 0.25, deg: 28 },
      { t: 0.5, deg: 0 },
      { t: 0.75, deg: -28 },
      { t: 1, deg: 0 },
    ],
    legFar_up: [
      { t: 0, deg: 0 },
      { t: 0.25, deg: -28 },
      { t: 0.5, deg: 0 },
      { t: 0.75, deg: 28 },
      { t: 1, deg: 0 },
    ],
  },
};

/**
 * Horizontal mirror of a cell raster (pure — allocates a fresh buffer, never
 * mutates the input). EAST facing is produced by baking WEST and mirroring each
 * frame, so the profile only needs authoring once. Row-major RGBA; column x
 * maps to (w-1-x), rows unchanged.
 */
export function mirrorFrame(r: Raster): Raster {
  const { w, h } = r;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const si = (y * w + x) * 4;
      const di = (y * w + (w - 1 - x)) * 4;
      out[di] = r.data[si];
      out[di + 1] = r.data[si + 1];
      out[di + 2] = r.data[si + 2];
      out[di + 3] = r.data[si + 3];
    }
  }
  return { data: out, w, h };
}
