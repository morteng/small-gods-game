/**
 * Parametric quadruped paper-doll — WEST facing (the animal faces LEFT).
 *
 * One declarative template builder + one params object per species. Sheep is
 * the first; goat proves the parameterisation (leaner barrel, longer legs,
 * brown palette, cocked tail) with ZERO new code. Everything here is
 * declarative — the pixels are painted by `quadruped-art.ts`, the motion is
 * keyframes over the chip vocabulary, and both are pure functions of the
 * params, so a species is data.
 *
 * WEST only, exactly like `lpc-humanoid-west.ts`: EAST comes free by baking
 * WEST and running each finished frame through `mirrorFrame`. Chip names keep
 * the profile Near/Far vocabulary so a future facing-agnostic clip mapper (and
 * every later species) addresses one uniform chip set.
 *
 * ── Layout (cell 64, y-down, ground line at row 60) ─────────────────────────
 *   ear      x15-21  y27-32        head   x10-19  y33-48
 *   neck     x20-25  y33-46        barrel x26-48  y37-49 (belly FLAT at 49)
 *   tail     x49-55  y34-50        legs   4 lanes of 3px, y50-59, in x28-46
 *
 * The barrel owns x26-48 ALONE: the neck and tail bands are clipped at their
 * split so nothing but the barrel is ever painted into the ROOT. A limb band
 * that spills into the root paints pixels its own silhouette hides at rest and
 * uncovers the moment it moves — that is precisely what left a pale spike
 * standing over the withers when the sheep put its head down. The bake harness
 * asserts `root === barrel` per species.
 *
 * The chip rects are pairwise disjoint AND — the point of drawing our own art —
 * no rect can contain a pixel belonging to another part, so `rootChipRaster`'s
 * clear never scoops the barrel. See the root-clear contract in
 * `quadruped-art.ts`; `scripts/quadruped-bake.ts` asserts it per species.
 */
import type { AnimTemplate, Clip } from './rig';
import type { Raster } from '../sprite-postprocess';
import { drawQuadrupedCell as paintCell } from './quadruped-art';

/** Axis-aligned box as float EDGES: [x0, y0, x1, y1], inclusive of both. */
export type QuadrupedBox = readonly [number, number, number, number];

/** A tapered quad (square ends — never a capsule; caps overshoot chip rects). */
export interface QuadrupedBand {
  from: readonly [number, number];
  to: readonly [number, number];
  fromHalf: number;
  toHalf: number;
}

/** Flat species palette — every colour a species can show, as '#rrggbb'. */
export interface QuadrupedPalette {
  fleeceLight: string;
  fleeceMid: string;
  fleeceShade: string;
  fleeceInk: string;
  faceLight: string;
  faceMid: string;
  faceDark: string;
  faceInk: string;
  eye: string;
  legNear: string;
  legFar: string;
  hoof: string;
}

/** Barrel profile. `belly` is the ground-facing EDGE (last opaque row = belly-1). */
export interface QuadrupedBody {
  cx: number;
  /** Half-length behind `cx` (the rump side). */
  rx: number;
  /**
   * Half-length in FRONT of `cx`, with its own profile exponent and belly
   * taper. The chest is the whole silhouette once the neck chip swings away,
   * so it must close on its own — a front tuned only to look right WITH the
   * neck attached is the bug that put a spike over the withers when grazing.
   */
  rxFront: number;
  plumpFront: number;
  taperFront: number;
  belly: number;
  /** Back height above the belly at the centre. */
  rise: number;
  /** Span [x0,x1] over which the belly is dead flat — every leg lane lives here. */
  flat: readonly [number, number];
  /** Belly rise per px behind the flat span (the flank tuck). */
  taper: number;
  /** Profile exponent: <1 barrels the silhouette, 1 = a plain ellipse. */
  plump: number;
  /** Fleece silhouette lump amplitude (px) and lattice frequency. */
  lump: number;
  lumpFreq: number;
}

export interface QuadrupedLegs {
  /** Lane left-x for [foreNear, foreFar, hindNear, hindFar]; all `width` wide. */
  laneX: readonly [number, number, number, number];
  width: number;
  /** Opaque width of the FAR pair (<= width) — a column narrower reads as depth. */
  farWidth: number;
  /** First leg row (must be `body.belly`, so the leg starts under a flat belly). */
  top: number;
  /** Knee/hock row — the upper/lower chip split. */
  knee: number;
  /** Exclusive bottom row; the far pair stops higher for a depth cue. */
  nearBottom: number;
  farBottom: number;
  /** Opaque width of the lower leg (fore legs align forward, hind legs back). */
  lowerWidth: number;
  hoofRows: number;
}

/**
 * Chip rects for the parts that are NOT derived from the leg lanes, as integer
 * INCLUSIVE cell boxes [x0,y0,x1,y1]. They are stated rather than derived
 * because they encode the disjointness contract (head x≤19 | neck x20-25 |
 * barrel x≥26; ear y≤31 | head/neck y≥32; tail x≥49) — the bake harness
 * asserts it, so a species that moves them finds out immediately.
 */
export interface QuadrupedRects {
  head: QuadrupedBox;
  neck: QuadrupedBox;
  ear: QuadrupedBox;
  tail: QuadrupedBox;
}

/** Rotation pivots for the non-leg chips (withers, poll, ear base, dock). */
export interface QuadrupedJoints {
  neck: readonly [number, number];
  head: readonly [number, number];
  ear: readonly [number, number];
  tail: readonly [number, number];
}

export interface QuadrupedParams {
  /** Species id — becomes the template name suffix. */
  species: string;
  /** Square cell size; 64 keeps the game's 2:1 downscale integral. */
  cell: number;
  /** Texture seed for the fleece value noise. Deterministic, never RNG. */
  seed: number;
  body: QuadrupedBody;
  legs: QuadrupedLegs;
  rects: QuadrupedRects;
  joints: QuadrupedJoints;
  /** Neck wedge, drawn from the withers up to the poll. */
  neck: QuadrupedBand;
  /** Pixels with centre x > this stay with the ROOT and read as the shoulder. */
  neckSplitX: number;
  tail: QuadrupedBand;
  /** Pixels with centre x < this stay with the ROOT and read as the rump. */
  tailSplitX: number;
  skull: QuadrupedBox;
  muzzle: QuadrupedBand;
  ear: QuadrupedBand;
  eye: readonly [number, number];
  /** Fleece curl noise frequency and how hard it perturbs the shading ramp. */
  fleeceCurl: number;
  fleeceContrast: number;
  palette: QuadrupedPalette;
}

/** Template chip order — the public vocabulary every clip keys on. */
export const QUADRUPED_CHIP_NAMES = [
  'body',
  'neck',
  'head',
  'ear',
  'tail',
  'legForeNear_up',
  'legForeNear_low',
  'legForeFar_up',
  'legForeFar_low',
  'legHindNear_up',
  'legHindNear_low',
  'legHindFar_up',
  'legHindFar_low',
] as const;

/** One '#rrggbb' per chip, in template order — the studio's bone overlay. */
export const QUADRUPED_CHIP_COLORS = [
  '#8899aa', // body
  '#f0c674', // neck
  '#e06c75', // head
  '#c678dd', // ear
  '#56b6c2', // tail
  '#98c379', // legForeNear_up
  '#6aa84f', // legForeNear_low
  '#4f7a3a', // legForeFar_up
  '#3a5c2b', // legForeFar_low
  '#61afef', // legHindNear_up
  '#3f8fd0', // legHindNear_low
  '#2a6ba0', // legHindFar_up
  '#1d4d75', // legHindFar_low
] as const;

/** A name from the template vocabulary. */
export type QuadrupedChipName = (typeof QUADRUPED_CHIP_NAMES)[number];

/**
 * Near ↔ Far partner of a chip name, or null when the chip is unpaired (body,
 * neck, head, ear, tail). Used by mirroring / future facing mappers.
 *
 * The swapped name is resolved AGAINST the vocabulary instead of being returned
 * straight out of the string replace, so the result is guaranteed to name a
 * real chip — `'fooNear'` returns null, not `'fooFar'` — and callers can feed
 * it to a `Set<QuadrupedChipName>` without a cast.
 */
export function quadrupedMirrorName(n: string): QuadrupedChipName | null {
  const swapped = n.includes('Near')
    ? n.replace('Near', 'Far')
    : n.includes('Far')
      ? n.replace('Far', 'Near')
      : null;
  if (swapped === null) return null;
  return QUADRUPED_CHIP_NAMES.find((c) => c === swapped) ?? null;
}

/**
 * Build the FK template for a species. Rects derive from the params, so a
 * species that moves its belly or its leg lanes gets matching chips for free —
 * and the "leg rect starts one row below a flat belly" contract is enforced
 * here rather than restated per species.
 */
export function buildQuadrupedTemplate(p: QuadrupedParams): AnimTemplate {
  const L = p.legs;
  const leg = (i: number, upName: string, lowName: string, zUp: number, upIdx: number, near: boolean) => {
    const x = L.laneX[i];
    const bottom = near ? L.nearBottom : L.farBottom;
    const cx = x + L.width / 2;
    return [
      {
        name: upName,
        rect: { x, y: L.top, w: L.width, h: L.knee - L.top },
        pivot: [cx, L.top] as [number, number],
        parent: 0,
        z: zUp,
      },
      {
        name: lowName,
        rect: { x, y: L.knee, w: L.width, h: bottom - L.knee },
        pivot: [cx, L.knee] as [number, number],
        parent: upIdx,
        z: zUp + 1,
      },
    ];
  };

  const box = (r: QuadrupedBox) => ({ x: r[0], y: r[1], w: r[2] - r[0] + 1, h: r[3] - r[1] + 1 });
  const R = p.rects;
  const J = p.joints;
  return {
    name: `quadruped-${p.species}-west`,
    cell: p.cell,
    chips: [
      // Root: the whole cell. Pivot sits at the near hooves so a death roll
      // tips the animal about its ground contact instead of its middle.
      { name: 'body', rect: { x: 0, y: 0, w: p.cell, h: p.cell }, pivot: [p.body.cx, L.nearBottom - 4], parent: -1, z: 0 },
      { name: 'neck', rect: box(R.neck), pivot: [J.neck[0], J.neck[1]], parent: 0, z: 6 },
      { name: 'head', rect: box(R.head), pivot: [J.head[0], J.head[1]], parent: 1, z: 7 },
      { name: 'ear', rect: box(R.ear), pivot: [J.ear[0], J.ear[1]], parent: 2, z: 8 },
      { name: 'tail', rect: box(R.tail), pivot: [J.tail[0], J.tail[1]], parent: 0, z: -1 },
      ...leg(0, 'legForeNear_up', 'legForeNear_low', 3, 5, true),
      ...leg(1, 'legForeFar_up', 'legForeFar_low', -6, 7, false),
      ...leg(2, 'legHindNear_up', 'legHindNear_low', 1, 9, true),
      ...leg(3, 'legHindFar_up', 'legHindFar_low', -4, 11, false),
    ],
  };
}

/** Paint the species' rest cell (re-exported from the art module). */
export function drawQuadrupedCell(p: QuadrupedParams): Raster {
  return paintCell(p);
}

// ── Species ─────────────────────────────────────────────────────────────────

export const SHEEP_PARAMS: QuadrupedParams = {
  species: 'sheep',
  cell: 64,
  seed: 1471,
  body: {
    cx: 37.5,
    rx: 11.4,
    rxFront: 11.9,
    plumpFront: 0.14,
    taperFront: 0.5,
    belly: 50,
    rise: 13,
    flat: [28, 47],
    taper: 1.6,
    plump: 0.3,
    lump: 0.5,
    lumpFreq: 0.22,
  },
  legs: {
    laneX: [28, 32, 40, 44],
    width: 3,
    farWidth: 2,
    top: 50,
    knee: 55,
    nearBottom: 60,
    farBottom: 59,
    lowerWidth: 2,
    hoofRows: 2,
  },
  rects: { head: [10, 33, 19, 48], neck: [20, 33, 25, 46], ear: [15, 27, 21, 32], tail: [49, 34, 55, 50] },
  joints: { neck: [26, 43], head: [20, 36], ear: [18, 32], tail: [49, 44] },
  neck: { from: [26, 43], to: [20, 35.5], fromHalf: 3.2, toHalf: 2 },
  neckSplitX: 25.5,
  tail: { from: [46.5, 42], to: [51.5, 49], fromHalf: 2.4, toHalf: 1.3 },
  tailSplitX: 49,
  skull: [13.5, 33, 19.5, 39.5],
  muzzle: { from: [15, 37], to: [11.5, 41], fromHalf: 3, toHalf: 1.8 },
  ear: { from: [18, 32.4], to: [20.5, 30], fromHalf: 1.7, toHalf: 1.2 },
  eye: [16, 35],
  fleeceCurl: 0.4,
  fleeceContrast: 0.22,
  palette: {
    fleeceLight: '#f3ecdd',
    fleeceMid: '#dcd0ba',
    fleeceShade: '#b6a78e',
    fleeceInk: '#6d5f4c',
    faceLight: '#6b5c50',
    faceMid: '#4d423a',
    faceDark: '#38302a',
    faceInk: '#241e1a',
    eye: '#cfc7b6',
    legNear: '#544539',
    legFar: '#3b3028',
    hoof: '#1d1813',
  },
};

/**
 * Second species from the SAME builder — the parameterisation proof. Leaner
 * barrel, longer legs, brown coat, a tail that cocks up instead of hanging.
 */
export const GOAT_PARAMS: QuadrupedParams = {
  species: 'goat',
  cell: 64,
  seed: 907,
  body: {
    cx: 37.5,
    rx: 11,
    rxFront: 11.9,
    plumpFront: 0.16,
    taperFront: 0.6,
    belly: 46,
    rise: 10,
    flat: [29, 47],
    taper: 1.5,
    plump: 0.35,
    lump: 0.25,
    lumpFreq: 0.5,
  },
  legs: {
    laneX: [29, 33, 40, 44],
    width: 3,
    farWidth: 2,
    top: 46,
    knee: 52,
    nearBottom: 60,
    farBottom: 59,
    lowerWidth: 2,
    hoofRows: 2,
  },
  rects: { head: [10, 32, 19, 46], neck: [20, 32, 25, 46], ear: [15, 26, 21, 31], tail: [48, 32, 55, 47] },
  // head pivot sits EXACTLY on the neck/head seam (x = head rect's right edge),
  // matching the sheep. It read 20.5 — a half-pixel past its own chip's rect,
  // which the pivot-in-rect invariant only tolerated by its 1px allowance.
  joints: { neck: [26, 41], head: [20, 34], ear: [18, 32], tail: [48, 39] },
  neck: { from: [26, 41], to: [20.5, 33.5], fromHalf: 2.8, toHalf: 1.8 },
  neckSplitX: 25.5,
  tail: { from: [46, 42.5], to: [50, 36.5], fromHalf: 1.8, toHalf: 1 },
  tailSplitX: 48,
  skull: [14.5, 32, 19.5, 37.5],
  muzzle: { from: [15, 35.5], to: [11.5, 39], fromHalf: 2.6, toHalf: 1.6 },
  ear: { from: [18, 31.4], to: [21.5, 28.1], fromHalf: 1.1, toHalf: 0.7 },
  eye: [16, 34],
  fleeceCurl: 0.9,
  fleeceContrast: 0.2,
  palette: {
    fleeceLight: '#a98a5e',
    fleeceMid: '#8b6d47',
    fleeceShade: '#67512f',
    fleeceInk: '#3d2e1c',
    faceLight: '#5a452c',
    faceMid: '#3f301e',
    faceDark: '#2c2115',
    faceInk: '#1a1209',
    eye: '#c9bda2',
    legNear: '#4a3826',
    legFar: '#33261a',
    hoof: '#150f09',
  },
};

export const SHEEP_WEST: AnimTemplate = buildQuadrupedTemplate(SHEEP_PARAMS);
export const GOAT_WEST: AnimTemplate = buildQuadrupedTemplate(GOAT_PARAMS);

// ── Clips ───────────────────────────────────────────────────────────────────
//
// Sign conventions in this cell (all +deg = clockwise in y-down screen space):
//   leg upper  — POSITIVE swings the leg FORWARD (screen-left, the facing).
//   neck       — POSITIVE lifts the head up/back; NEGATIVE drops it to graze.
//   head       — POSITIVE raises the muzzle; the graze pose stacks a big
//                negative neck with a positive head so the face points DOWN.
//   ear        — NEGATIVE pricks the ear up; POSITIVE droops it.
//   tail       — NEGATIVE raises the tail; POSITIVE swings it toward the rump.

/** Shanks counter their thigh so the hoof stays roughly under the body. */
const SHANK_COUNTER = [
  { from: 'legForeNear_up', prop: 'deg', to: 'legForeNear_low', gain: -0.7, lag: 0.06 },
  { from: 'legForeFar_up', prop: 'deg', to: 'legForeFar_low', gain: -0.7, lag: 0.06 },
  { from: 'legHindNear_up', prop: 'deg', to: 'legHindNear_low', gain: -0.7, lag: 0.06 },
  { from: 'legHindFar_up', prop: 'deg', to: 'legHindFar_low', gain: -0.7, lag: 0.06 },
] as const;

/**
 * Walk — diagonal-pair gait. foreNear + hindFar swing together against
 * foreFar + hindNear, which is what makes a quadruped read as a quadruped
 * rather than a four-legged wobble. Root dy bobs twice per stride (once per
 * diagonal plant); the neck counter-bobs so the head stays level.
 */
export const CLIP_QUAD_WALK: Clip = {
  name: 'walk',
  frames: 8,
  couple: SHANK_COUNTER,
  tracks: {
    body: [
      { t: 0, deg: 0, dy: 0 },
      { t: 0.11, deg: 0, dy: 0 },
      { t: 0.13, deg: 0, dy: -1 },
      { t: 0.32, deg: 0, dy: -1 },
      { t: 0.34, deg: 0, dy: 0 },
      { t: 0.61, deg: 0, dy: 0 },
      { t: 0.63, deg: 0, dy: -1 },
      { t: 0.82, deg: 0, dy: -1 },
      { t: 0.84, deg: 0, dy: 0 },
      { t: 1, deg: 0, dy: 0 },
    ],
    legForeNear_up: [
      { t: 0, deg: 15 },
      { t: 0.25, deg: 0 },
      { t: 0.5, deg: -15 },
      { t: 0.75, deg: 0 },
      { t: 1, deg: 15 },
    ],
    legHindFar_up: [
      { t: 0, deg: 13 },
      { t: 0.25, deg: 0 },
      { t: 0.5, deg: -13 },
      { t: 0.75, deg: 0 },
      { t: 1, deg: 13 },
    ],
    legForeFar_up: [
      { t: 0, deg: -15 },
      { t: 0.25, deg: 0 },
      { t: 0.5, deg: 15 },
      { t: 0.75, deg: 0 },
      { t: 1, deg: -15 },
    ],
    legHindNear_up: [
      { t: 0, deg: -13 },
      { t: 0.25, deg: 0 },
      { t: 0.5, deg: 13 },
      { t: 0.75, deg: 0 },
      { t: 1, deg: -13 },
    ],
    neck: [
      { t: 0, deg: 0 },
      { t: 0.25, deg: 3 },
      { t: 0.5, deg: 0 },
      { t: 0.75, deg: 3 },
      { t: 1, deg: 0 },
    ],
    head: [
      { t: 0, deg: 0 },
      { t: 0.25, deg: -3 },
      { t: 0.5, deg: 0 },
      { t: 0.75, deg: -3 },
      { t: 1, deg: 0 },
    ],
    tail: [
      { t: 0, deg: 0 },
      { t: 0.25, deg: 8 },
      { t: 0.5, deg: 0 },
      { t: 0.75, deg: -8 },
      { t: 1, deg: 0 },
    ],
  },
};

/** Idle — breathing, one ear twitch, one tail flick. Near-still on purpose. */
export const CLIP_QUAD_IDLE: Clip = {
  name: 'idle',
  frames: 8,
  tracks: {
    body: [
      { t: 0, deg: 0, dy: 0 },
      { t: 0.32, deg: 0, dy: 0 },
      { t: 0.34, deg: 0, dy: -1 },
      { t: 0.61, deg: 0, dy: -1 },
      { t: 0.63, deg: 0, dy: 0 },
      { t: 1, deg: 0, dy: 0 },
    ],
    head: [
      { t: 0, deg: 0 },
      { t: 0.32, deg: 2 },
      { t: 0.64, deg: 0 },
      { t: 1, deg: 0 },
    ],
    ear: [
      { t: 0, deg: 0 },
      { t: 0.5, deg: 0 },
      { t: 0.58, deg: -20 },
      { t: 0.68, deg: 7 },
      { t: 0.78, deg: 0 },
      { t: 1, deg: 0 },
    ],
    tail: [
      { t: 0, deg: 0 },
      { t: 0.42, deg: 0 },
      { t: 0.56, deg: 11 },
      { t: 0.72, deg: -6 },
      { t: 0.88, deg: 0 },
      { t: 1, deg: 0 },
    ],
  },
};

/** Graze — neck swings the head down to the grass and HOLDS there, chewing. */
export const CLIP_QUAD_GRAZE: Clip = {
  name: 'graze',
  frames: 10,
  tracks: {
    neck: [
      { t: 0, deg: 0 },
      { t: 0.3, deg: -74 },
      { t: 0.55, deg: -74 },
      { t: 0.7, deg: -70 },
      { t: 0.85, deg: -74 },
      { t: 1, deg: -74 },
    ],
    head: [
      { t: 0, deg: 0 },
      { t: 0.3, deg: 38 },
      { t: 0.55, deg: 38 },
      { t: 0.7, deg: 32 },
      { t: 0.85, deg: 38 },
      { t: 1, deg: 38 },
    ],
    ear: [
      { t: 0, deg: 0 },
      { t: 0.3, deg: 16 },
      { t: 1, deg: 16 },
    ],
    body: [
      { t: 0, deg: 0, dy: 0 },
      { t: 0.3, deg: 0, dy: 0 },
      { t: 1, deg: 0, dy: 0 },
    ],
    legHindNear_up: [
      { t: 0, deg: 0 },
      { t: 0.35, deg: -10 },
      { t: 0.8, deg: -10 },
      { t: 1, deg: -7 },
    ],
    legHindNear_low: [
      { t: 0, deg: 0 },
      { t: 0.35, deg: 9 },
      { t: 0.8, deg: 9 },
      { t: 1, deg: 6 },
    ],
    tail: [
      { t: 0, deg: 0 },
      { t: 0.45, deg: 0 },
      { t: 0.56, deg: 10 },
      { t: 0.7, deg: -7 },
      { t: 0.84, deg: 0 },
      { t: 1, deg: 0 },
    ],
  },
};

/** Startle — the head SNAPS up on the first two frames, then settles alert. */
export const CLIP_QUAD_STARTLE: Clip = {
  name: 'startle',
  frames: 8,
  tracks: {
    neck: [
      { t: 0, deg: 0 },
      { t: 0.1, deg: 26 },
      { t: 0.26, deg: 19 },
      { t: 1, deg: 21 },
    ],
    head: [
      { t: 0, deg: 0 },
      { t: 0.1, deg: 8 },
      { t: 0.26, deg: 5 },
      { t: 1, deg: 6 },
    ],
    ear: [
      { t: 0, deg: 0 },
      { t: 0.1, deg: -20 },
      { t: 0.26, deg: -15 },
      { t: 1, deg: -16 },
    ],
    body: [
      { t: 0, deg: 0, dx: 0, dy: 0 },
      { t: 0.1, deg: -5, dx: 2, dy: -1 },
      { t: 0.3, deg: -2, dx: 1, dy: 0 },
      { t: 1, deg: -3, dx: 1, dy: 0 },
    ],
    tail: [
      { t: 0, deg: 0 },
      { t: 0.12, deg: -48 },
      { t: 0.34, deg: -38 },
      { t: 1, deg: -40 },
    ],
    legForeNear_up: [
      { t: 0, deg: 0 },
      { t: 0.12, deg: -14 },
      { t: 1, deg: -10 },
    ],
    legForeFar_up: [
      { t: 0, deg: 0 },
      { t: 0.12, deg: -11 },
      { t: 1, deg: -8 },
    ],
    legHindNear_up: [
      { t: 0, deg: 0 },
      { t: 0.12, deg: 12 },
      { t: 1, deg: 9 },
    ],
    legHindFar_up: [
      { t: 0, deg: 0 },
      { t: 0.12, deg: 10 },
      { t: 1, deg: 7 },
    ],
  },
  couple: SHANK_COUNTER,
};

/**
 * Death — the legs buckle, the body sinks and tips onto its side, and the head
 * drops LAST. The final two keyframes are identical, so the clip ends at rest
 * and holds there however long the player looks at it.
 */
export const CLIP_QUAD_DEATH: Clip = {
  name: 'death',
  frames: 12,
  tracks: {
    body: [
      { t: 0, deg: 0, dy: 0 },
      { t: 0.2, deg: -4, dy: 1 },
      { t: 0.5, deg: -12, dy: 4 },
      { t: 0.78, deg: -19, dy: 7 },
      { t: 0.9, deg: -20, dy: 8 },
      { t: 1, deg: -20, dy: 8 },
    ],
    legForeNear_up: [
      { t: 0, deg: 0 },
      { t: 0.2, deg: 16 },
      { t: 0.5, deg: 48 },
      { t: 0.9, deg: 62 },
      { t: 1, deg: 62 },
    ],
    legForeNear_low: [
      { t: 0, deg: 0 },
      { t: 0.2, deg: -12 },
      { t: 0.5, deg: -62 },
      { t: 0.9, deg: -92 },
      { t: 1, deg: -92 },
    ],
    legForeFar_up: [
      { t: 0, deg: 0 },
      { t: 0.2, deg: 12 },
      { t: 0.5, deg: 40 },
      { t: 0.9, deg: 54 },
      { t: 1, deg: 54 },
    ],
    legForeFar_low: [
      { t: 0, deg: 0 },
      { t: 0.2, deg: -10 },
      { t: 0.5, deg: -54 },
      { t: 0.9, deg: -84 },
      { t: 1, deg: -84 },
    ],
    legHindNear_up: [
      { t: 0, deg: 0 },
      { t: 0.2, deg: -16 },
      { t: 0.5, deg: -48 },
      { t: 0.9, deg: -64 },
      { t: 1, deg: -64 },
    ],
    legHindNear_low: [
      { t: 0, deg: 0 },
      { t: 0.2, deg: 12 },
      { t: 0.5, deg: 62 },
      { t: 0.9, deg: 94 },
      { t: 1, deg: 94 },
    ],
    legHindFar_up: [
      { t: 0, deg: 0 },
      { t: 0.2, deg: -12 },
      { t: 0.5, deg: -40 },
      { t: 0.9, deg: -56 },
      { t: 1, deg: -56 },
    ],
    legHindFar_low: [
      { t: 0, deg: 0 },
      { t: 0.2, deg: 10 },
      { t: 0.5, deg: 54 },
      { t: 0.9, deg: 86 },
      { t: 1, deg: 86 },
    ],
    neck: [
      { t: 0, deg: 0 },
      { t: 0.25, deg: 8 },
      { t: 0.5, deg: -6 },
      { t: 0.82, deg: -52 },
      { t: 0.94, deg: -58 },
      { t: 1, deg: -58 },
    ],
    head: [
      { t: 0, deg: 0 },
      { t: 0.25, deg: -6 },
      { t: 0.5, deg: 4 },
      { t: 0.82, deg: 26 },
      { t: 0.94, deg: 32 },
      { t: 1, deg: 32 },
    ],
    ear: [
      { t: 0, deg: 0 },
      { t: 0.5, deg: 8 },
      { t: 0.9, deg: 18 },
      { t: 1, deg: 18 },
    ],
    tail: [
      { t: 0, deg: 0 },
      { t: 0.5, deg: 10 },
      { t: 0.9, deg: 20 },
      { t: 1, deg: 20 },
    ],
  },
};

/** Shipped clip set, in the order the studio lists them. */
export const SHEEP_CLIPS: readonly Clip[] = [
  CLIP_QUAD_WALK,
  CLIP_QUAD_IDLE,
  CLIP_QUAD_GRAZE,
  CLIP_QUAD_STARTLE,
  CLIP_QUAD_DEATH,
];
