/**
 * BVH → paper-doll rig importer (pure leaf: node + browser, no DOM, no deps).
 *
 * Free motion capture instead of hand-keyed spikes. Parse a BVH skeleton, FK it
 * in 3D, then project each mapped bone into ONE camera plane per authored
 * facing and read out the angle the rig already speaks: parent-relative
 * degrees, clockwise, y-down — the exact convention `rotAbout` in `rig.ts`
 * implements, which is why this module imports it rather than re-deriving it.
 * Output is consumed by `sampleClip`/`bakeClip` unchanged.
 *
 * DETERMINISM IS A CONTRACT (spec contract 2): imported motion is checked-in
 * CODE, not a runtime asset. Same BVH + same options → byte-identical `Clip`:
 * pure float math in a fixed order, angles quantized to 0.5°, translations to
 * 0.25px, track keys emitted in template chip order.
 *
 * THE ZERO OF EVERY TRACK IS THE REFERENCE FRAME, NOT THE TEMPLATE'S REST
 * DIRECTION. A chip's `deg` is how far the bone has swung SINCE the reference
 * pose, so the reference pose is what the rig's rest cell draws. Pick a frame
 * where the actor stands like the LPC idle — or `'mean'`, which is usually
 * right for a cyclic clip. GOTCHA: in the cgspeed CMU conversion, frame 0 is a
 * SYNTHETIC T-POSE the converter prepended (see the corpus READMEFIRST), not
 * capture data; importing CMU with the default `referenceFrame: 0` reads every
 * standing pose as "arms swung 90° down" and folds the arms across the body.
 *
 * Two consequences of that choice, measured against the CMU corpus and left
 * alone rather than papered over:
 * - The LPC idle cell holds its arms SPLAYED (the south upper-arm chip rests at
 *   ~54°/125°, not vertical), while a standing actor's arms hang straight down.
 *   Transferring the delta keeps the motion honest and the absolute pose ~35°
 *   off. Matching absolutes instead would fix the arms by breaking everything
 *   with a different limb ratio — the studio (M2) is where that gets judged.
 * - Screen angle is unwrapped onto the nearest branch per frame, so a gesture
 *   sampled below twice its own rate ALIASES: a fast wave decimated to 10
 *   frames winds up hundreds of degrees. Import gestures with a tighter
 *   `range` and more `frames`, not by loosening tolerances.
 *
 * HONEST LIMIT — a fixed 64px chip cannot foreshorten. A bone swinging toward
 * the camera loses screen LENGTH, and the rig has no third axis to spend that
 * on. What the projection can express lands in `deg`; the leftover joint
 * position error lands in `dx/dy` (exactly what `Keyframe` documents them for)
 * up to `maxResidualPx`, and past that it stays an artifact judged in the
 * studio — never silently "fixed" by inventing geometry the chip doesn't have.
 * A bone that projects to nothing at all (a sideways-raised arm seen in the
 * sagittal view) HOLDS its previous angle instead of spinning on noise.
 */
import {
  applyAffine,
  invertAffine,
  mulAffine,
  rotAbout,
  sampleTrack,
  type Affine,
  type AnimTemplate,
  type Clip,
  type Keyframe,
} from './rig';
import { LPC_HUMANOID_SOUTH } from './lpc-humanoid';
import { LPC_HUMANOID_NORTH } from './lpc-humanoid-north';
import { LPC_HUMANOID_WEST } from './lpc-humanoid-west';

// ── BVH data model ──────────────────────────────────────────────────────────

export const BVH_CHANNELS = [
  'Xposition',
  'Yposition',
  'Zposition',
  'Xrotation',
  'Yrotation',
  'Zrotation',
] as const;

export type BvhChannel = (typeof BVH_CHANNELS)[number];

export interface BvhJoint {
  /** Joint name as declared. End Sites are named `<parent>_End`. */
  name: string;
  /** Index of the parent joint, or -1 for the root. Parents precede children. */
  parent: number;
  /** Rest translation from the parent joint. */
  offset: [number, number, number];
  /** Declared channel order — rotations compose in THIS order, left to right. */
  channels: BvhChannel[];
}

export interface BvhClip {
  joints: BvhJoint[];
  /** One row per frame, concatenating every joint's channel values in order. */
  frames: number[][];
  /** Seconds per frame (the cgspeed CMU corpus is 120 fps → `.0083333`). */
  frameTime: number;
}

/**
 * Recursive-descent BVH parse. Whitespace-token based, keywords case-folded,
 * and it reads the channel order DECLARED PER JOINT rather than assuming one
 * (the CMU corpus is uniformly ZYX, but the format does not promise that).
 * Joint names containing spaces are not supported — no corpus we target emits
 * them, and the format gives no way to tell a name from the next keyword.
 */
export function parseBvh(text: string): BvhClip {
  const tok = text.split(/\s+/).filter((s) => s.length > 0);
  let i = 0;
  const take = (): string => {
    if (i >= tok.length) throw new Error('BVH: unexpected end of file');
    return tok[i++];
  };
  const expect = (word: string): void => {
    const t = take();
    if (t.toUpperCase() !== word.toUpperCase()) {
      throw new Error(`BVH: expected "${word}", got "${t}" at token ${i - 1}`);
    }
  };
  // Number(".0083333") is 0.0083333 — the corpus writes floats with no leading
  // zero, so anything hand-rolled here would have to handle that too.
  const num = (): number => {
    const t = take();
    const v = Number(t);
    if (!Number.isFinite(v)) throw new Error(`BVH: expected a number, got "${t}" at token ${i - 1}`);
    return v;
  };
  const channel = (t: string): BvhChannel => {
    const m = BVH_CHANNELS.find((c) => c.toLowerCase() === t.toLowerCase());
    if (!m) throw new Error(`BVH: unknown channel "${t}" at token ${i - 1}`);
    return m;
  };

  const joints: BvhJoint[] = [];
  const parseJoint = (name: string, parent: number): void => {
    const self = joints.length;
    joints.push({ name, parent, offset: [0, 0, 0], channels: [] });
    expect('{');
    for (;;) {
      const t = take();
      const k = t.toUpperCase();
      if (k === 'OFFSET') joints[self].offset = [num(), num(), num()];
      else if (k === 'CHANNELS') {
        const n = num();
        const ch: BvhChannel[] = [];
        for (let c = 0; c < n; c++) ch.push(channel(take()));
        joints[self].channels = ch;
      } else if (k === 'JOINT') parseJoint(take(), self);
      else if (k === 'END') {
        expect('Site');
        // End Sites carry geometry (the toe tip, the fingertip) but no channels,
        // so a bone map can still name them as a distal endpoint.
        parseJoint(`${name}_End`, self);
      } else if (k === '}') return;
      else throw new Error(`BVH: unexpected token "${t}" at ${i - 1}`);
    }
  };

  expect('HIERARCHY');
  expect('ROOT');
  parseJoint(take(), -1);
  expect('MOTION');
  expect('Frames:');
  const frameCount = num();
  expect('Frame');
  expect('Time:');
  const frameTime = num();

  const width = joints.reduce((s, j) => s + j.channels.length, 0);
  const frames: number[][] = [];
  for (let f = 0; f < frameCount; f++) {
    const row = new Array<number>(width);
    for (let c = 0; c < width; c++) row[c] = num();
    frames.push(row);
  }
  return { joints, frames, frameTime };
}

// ── Bone maps (data) ────────────────────────────────────────────────────────

/**
 * The three AUTHORED facings. East is never imported: `facing.ts` bakes west
 * and mirrors each finished frame, so a west clip already serves both.
 */
export type RigFacing = 'down' | 'up' | 'left';

/** A joint name, or candidate names tried in order (skeleton dialects vary). */
export type JointRef = string | readonly string[];

export interface BvhBone {
  /** Proximal joint — also the point the chip's pivot is placed at. */
  from: JointRef;
  /** Distal joint — the bone direction is `to − from`. */
  to: JointRef;
  /** Rig chip this bone drives. */
  chip: string;
  /**
   * 'translate' bones never rotate their chip; only the dx/dy residual moves
   * it. The front-view head rule from `lpc-humanoid.ts`: an in-plane head
   * rotation reads as a sideways ear-to-shoulder tilt, so a frontal nod is
   * faked with translation. In profile a nod IS in-plane, so west rotates.
   */
  mode?: 'rotate' | 'translate';
}

export interface BvhFoot {
  /** Ankle joint — stance is detected from its world height and speed. */
  joint: JointRef;
  /** Chip carrying the sole, and the rest-space sole point (as `Clip.plant`). */
  chip: string;
  point: [number, number];
}

export interface FacingBoneMap {
  template: AnimTemplate;
  bones: readonly BvhBone[];
  /** Same skeletal order in every facing, so a stance index means one thing. */
  feet: readonly BvhFoot[];
}

export interface BvhBoneMap {
  /** Joints whose separation gives the body's lateral axis (left, right). */
  lateral: [JointRef, JointRef];
  /** Root joint, and the chip it translates (the rig root). */
  root: { joint: JointRef; chip: string };
  facings: Record<RigFacing, FacingBoneMap>;
}

// CMU / cgspeed joint names. The structural carriers (LHipJoint, LowerBack,
// LeftShoulder…) are deliberately unnamed here — a bone only ever needs its two
// ENDPOINTS, so a skeleton that omits the carriers still maps.
const HEAD: JointRef = ['Neck1', 'Neck'];

const HUMANOID_BONES = (
  armUp: string,
  armFore: string,
  legUp: string,
  legFore: string,
  side: 'Left' | 'Right',
): BvhBone[] => [
  { from: `${side}Arm`, to: `${side}ForeArm`, chip: armUp },
  { from: `${side}ForeArm`, to: `${side}Hand`, chip: armFore },
  { from: `${side}UpLeg`, to: `${side}Leg`, chip: legUp },
  { from: `${side}Leg`, to: `${side}Foot`, chip: legFore },
];

/**
 * CMU humanoid → the three authored LPC facings.
 *
 * Screen-side flips between the frontal facings and that is the whole reason
 * the map is per-facing: `lpc-humanoid.ts` names chips by SCREEN side, so
 * facing the camera the actor's LEFT arm is chip `armR_up`, and from behind it
 * is `armL_up`. West's near/far vocabulary follows from the geometry: with the
 * character's forward pointing screen-left, its right side turns away from the
 * camera, so the NEAR limbs are the actor's LEFT ones. (Derived, then judged in
 * the studio — if a west import reads inside-out, these four lines swap.)
 */
export const HUMANOID_BVH_MAP: BvhBoneMap = {
  lateral: ['LeftUpLeg', 'RightUpLeg'],
  root: { joint: 'Hips', chip: 'trunk' },
  facings: {
    down: {
      template: LPC_HUMANOID_SOUTH,
      bones: [
        ...HUMANOID_BONES('armR_up', 'armR_fore', 'legR_up', 'legR_fore', 'Left'),
        ...HUMANOID_BONES('armL_up', 'armL_fore', 'legL_up', 'legL_fore', 'Right'),
        { from: HEAD, to: 'Head', chip: 'head', mode: 'translate' },
      ],
      feet: [
        { joint: 'LeftFoot', chip: 'legR_fore', point: [39.5, 62] },
        { joint: 'RightFoot', chip: 'legL_fore', point: [24.5, 62] },
      ],
    },
    up: {
      template: LPC_HUMANOID_NORTH,
      bones: [
        ...HUMANOID_BONES('armL_up', 'armL_fore', 'legL_up', 'legL_fore', 'Left'),
        ...HUMANOID_BONES('armR_up', 'armR_fore', 'legR_up', 'legR_fore', 'Right'),
        { from: HEAD, to: 'Head', chip: 'head', mode: 'translate' },
      ],
      feet: [
        { joint: 'LeftFoot', chip: 'legL_fore', point: [24.5, 62] },
        { joint: 'RightFoot', chip: 'legR_fore', point: [39.5, 62] },
      ],
    },
    left: {
      template: LPC_HUMANOID_WEST,
      bones: [
        ...HUMANOID_BONES('armNear_up', 'armNear_fore', 'legNear_up', 'legNear_fore', 'Left'),
        ...HUMANOID_BONES('armFar_up', 'armFar_fore', 'legFar_up', 'legFar_fore', 'Right'),
        { from: HEAD, to: 'Head', chip: 'head' },
      ],
      feet: [
        { joint: 'LeftFoot', chip: 'legNear_fore', point: [27.5, 60] },
        { joint: 'RightFoot', chip: 'legFar_fore', point: [36, 61] },
      ],
    },
  },
};

/*
 * QUADRUPED_BVH_MAP — deliberately ABSENT, not forgotten. The spec records CMU
 * quadruped source data as UNVERIFIED; until a usable capture exists there is
 * nothing to map, and inventing a map would be pretending. The sheep keyframes
 * stay hand-authored until then. When data lands, it slots in here as a second
 * `BvhBoneMap` against the quadruped template — no importer change needed.
 */

// ── Import options ──────────────────────────────────────────────────────────

export interface BvhImportOptions {
  /** Clip name written into every facing's `Clip`. */
  name?: string;
  /**
   * The pose taken to BE the rig's rest cell. A frame index, or `'mean'` (the
   * per-bone mean angle and per-joint mean position — usually right for a
   * cyclic clip, and the escape hatch from the CMU T-pose at frame 0).
   */
  referenceFrame?: number | 'mean';
  /** Inclusive source frame range to import — trim a capture to ONE cycle. */
  range?: [number, number];
  /** Baked frame count. Source frames are point-sampled evenly onto this. */
  frames?: number;
  /** World up axis (the cgspeed CMU conversion is Y-up). */
  up?: [number, number, number];
  /** Character forward at the reference pose; default guessed from the hips. */
  forward?: [number, number, number];
  /** Figure height in cell px the skeleton is scaled onto. */
  figureHeightPx?: number;
  /** Explicit px per BVH unit — overrides `figureHeightPx`. */
  pxPerUnit?: number;
  /** Foot policy. 'auto' picks locomotion once the root travels far enough. */
  motion?: 'auto' | 'stationary' | 'locomotion';
  /**
   * What locomotion does with the net travel it compensates out of the feet.
   * 'in-place' (default) returns the body to where it started; 'advance' lets
   * it cross the cell by one stride. See the locomotion branch for why the
   * runtime wants the former.
   */
  rootMotion?: 'in-place' | 'advance';
  /** Loop policy. 'auto' closes a clip only if it already reads as cyclic. */
  loop?: 'auto' | 'wrap' | 'none';
  /** Keyframe fit tolerances and cap. */
  degTol?: number;
  pxTol?: number;
  maxKeys?: number;
  /** Residual translation clamp for non-root chips, px. */
  maxResidualPx?: number;
}

/**
 * Tunables. Every one of these is a first guess to be re-judged in the motion
 * studio against LPC's own baked rows (plan slice M2), not a measured constant.
 */
const D = {
  /** LPC figure: head top (y 11) to sole (y 62). */
  figureHeightPx: 51,
  /** Fit until no frame deviates by more than this. */
  degTol: 2,
  pxTol: 0.5,
  maxKeys: 12,
  /**
   * Chips are placed at their own absolute targets, so an unclamped residual
   * pulls a foreshortened limb clean off its parent. 3px on a 64px cell is the
   * tear-vs-truth dial: raise it for honesty, lower it for cohesion.
   */
  maxResidualPx: 3,
  /** Output quantization — the byte-stability half of the determinism contract. */
  degQuantum: 0.5,
  pxQuantum: 0.25,
  /** A clip reads as cyclic if its last pose is within this of its first. */
  loopDegTol: 8,
  loopPxTol: 1.5,
  /** Fraction of the clip the closing blend is spread over. */
  loopTailFrac: 0.25,
  /** Root travel (as a fraction of figure height) that means "locomotion". */
  travelFrac: 0.2,
  /**
   * Stance: ankle within this fraction of figure height of the lowest ankle
   * seen, moving slower than `stanceSpeedPerSec` figure-heights per SECOND.
   * Per second, not per frame, or the test would silently tighten every time
   * the baked frame count went up. Measured on the CMU walks: a stance ankle
   * runs 0.03–0.2 figure-heights/s, a swinging one 1.5–3.
   */
  stanceHeightFrac: 0.06,
  stanceSpeedPerSec: 0.4,
  /** A foot is planted for the clip only if it is stance this often. */
  stancePlantFrac: 0.9,
  /** Below this fraction of its 3D length a bone is out-of-plane, not rotated. */
  degenerateFrac: 0.15,
} as const;

// ── 3D helpers (local: no vector library in this codebase to borrow) ────────

type Vec3 = [number, number, number];
type Mat3 = [number, number, number, number, number, number, number, number, number];

const IDENT3: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const IDENTITY2D: Affine = [1, 0, 0, 0, 1, 0];

const dot3 = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub3 = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross3 = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm3 = (a: Vec3): Vec3 => {
  const L = Math.hypot(a[0], a[1], a[2]);
  return L > 0 ? [a[0] / L, a[1] / L, a[2] / L] : [0, 0, 0];
};

const mul3 = (A: Mat3, B: Mat3): Mat3 => {
  const out = new Array<number>(9);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      out[r * 3 + c] = A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c];
    }
  }
  return out as Mat3;
};

const apply3 = (M: Mat3, v: Vec3): Vec3 => [
  M[0] * v[0] + M[1] * v[1] + M[2] * v[2],
  M[3] * v[0] + M[4] * v[1] + M[5] * v[2],
  M[6] * v[0] + M[7] * v[1] + M[8] * v[2],
];

const axisRot = (axis: 'X' | 'Y' | 'Z', deg: number): Mat3 => {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  if (axis === 'X') return [1, 0, 0, 0, c, -s, 0, s, c];
  if (axis === 'Y') return [c, 0, s, 0, 1, 0, -s, 0, c];
  return [c, -s, 0, s, c, 0, 0, 0, 1];
};

/** World joint positions for one motion row (parents precede children). */
export function fkPositions(bvh: BvhClip, frame: readonly number[]): Vec3[] {
  const pos: Vec3[] = [];
  const rot: Mat3[] = [];
  let c = 0;
  for (let j = 0; j < bvh.joints.length; j++) {
    const J = bvh.joints[j];
    const t: Vec3 = [J.offset[0], J.offset[1], J.offset[2]];
    let m: Mat3 = IDENT3;
    for (const ch of J.channels) {
      const v = frame[c++];
      if (ch === 'Xposition') t[0] += v;
      else if (ch === 'Yposition') t[1] += v;
      else if (ch === 'Zposition') t[2] += v;
      else m = mul3(m, axisRot(ch[0] as 'X' | 'Y' | 'Z', v));
    }
    const P = J.parent < 0 ? IDENT3 : rot[J.parent];
    const O: Vec3 = J.parent < 0 ? [0, 0, 0] : pos[J.parent];
    const w = apply3(P, t);
    pos[j] = [O[0] + w[0], O[1] + w[1], O[2] + w[2]];
    rot[j] = mul3(P, m);
  }
  return pos;
}

// ── Projection ──────────────────────────────────────────────────────────────

/**
 * Screen-right axis for a facing, given the character's ground forward.
 * Frontal facings look ALONG the character's forward (or against it); west
 * points that forward at screen-left, which is what makes it the sagittal cut.
 */
function facingRight(facing: RigFacing, fwd: Vec3, up: Vec3): Vec3 {
  if (facing === 'down') return norm3(cross3(up, fwd)); // character faces the camera
  if (facing === 'up') return norm3(cross3(fwd, up)); // back view — south mirrored
  return [-fwd[0], -fwd[1], -fwd[2]]; // west: forward points screen-LEFT
}

/** Unwrap `a` onto the branch nearest `prev` — tracks keep turning past ±180°. */
const unwrap = (a: number, prev: number): number =>
  Number.isNaN(prev) ? a : a + 360 * Math.round((prev - a) / 360);

const quant = (v: number, step: number): number => {
  const r = Math.round(v / step) * step;
  return r === 0 ? 0 : r; // never emit -0: it serializes fine but compares badly
};

interface FrameSample {
  deg: number;
  dx: number;
  dy: number;
}

// ── The importer ────────────────────────────────────────────────────────────

/**
 * Project a BVH clip onto every authored facing.
 *
 * Bones naming joints the skeleton doesn't have are skipped silently — that is
 * how one map serves skeleton dialects (and how a fixture can omit a limb).
 */
export function projectToRig(
  bvh: BvhClip,
  map: BvhBoneMap,
  opts: BvhImportOptions = {},
): Record<RigFacing, Clip> {
  if (bvh.frames.length === 0) throw new Error('BVH: clip has no frames');

  const index = new Map<string, number>();
  bvh.joints.forEach((j, k) => {
    if (!index.has(j.name)) index.set(j.name, k);
  });
  const resolve = (ref: JointRef): number => {
    for (const n of typeof ref === 'string' ? [ref] : ref) {
      const k = index.get(n);
      if (k !== undefined) return k;
    }
    return -1;
  };

  // Source frames: trim to a cycle, then point-sample onto the baked count.
  // Point sampling (not averaging) keeps the import a pure selection, and the
  // frame count IS the decimation — 120fps down to a handful of baked cells.
  // Two things bite here and both are the caller's to get right: a `range`
  // that isn't one cycle, and a gesture faster than half the baked rate (the
  // angle unwrapper cannot tell a 200° step from a -160° one, so a fast wave
  // at 10 frames winds up instead of waving).
  const [r0, r1] = opts.range ?? [0, bvh.frames.length - 1];
  const lo = Math.max(0, Math.min(r0, bvh.frames.length - 1));
  const hi = Math.max(lo, Math.min(r1, bvh.frames.length - 1));
  const span = hi - lo;
  const outCount = Math.max(1, Math.min(opts.frames ?? span + 1, span + 1));
  const srcIdx: number[] = [];
  for (let f = 0; f < outCount; f++) {
    srcIdx.push(outCount === 1 ? lo : lo + Math.round((f * span) / (outCount - 1)));
  }
  const positions = srcIdx.map((f) => fkPositions(bvh, bvh.frames[f]));
  const N = positions.length;

  const up = norm3(opts.up ?? [0, 1, 0]);
  const refMode = opts.referenceFrame ?? 0;
  const refFrame = refMode === 'mean' ? -1 : Math.max(0, Math.min(refMode, N - 1));
  /** Reference position of a joint: one frame's, or the mean over the clip. */
  const refPos = (j: number): Vec3 => {
    if (refFrame >= 0) return positions[refFrame][j];
    const s: Vec3 = [0, 0, 0];
    for (const p of positions) {
      s[0] += p[j][0];
      s[1] += p[j][1];
      s[2] += p[j][2];
    }
    return [s[0] / N, s[1] / N, s[2] / N];
  };

  // Forward from the hip axis: right = L→R across the pelvis, and a character
  // facing -Z with up +Y has its right at +X, i.e. forward = up × right.
  const [li, ri] = [resolve(map.lateral[0]), resolve(map.lateral[1])];
  let fwd: Vec3;
  if (opts.forward) fwd = norm3(opts.forward);
  else if (li >= 0 && ri >= 0) fwd = norm3(cross3(up, sub3(refPos(ri), refPos(li))));
  else fwd = [0, 0, -1];
  // Flatten onto the ground plane so the screen basis stays orthonormal.
  fwd = norm3([
    fwd[0] - up[0] * dot3(fwd, up),
    fwd[1] - up[1] * dot3(fwd, up),
    fwd[2] - up[2] * dot3(fwd, up),
  ]);

  // Scale: frame 0's vertical extent is the standing height (in the CMU corpus
  // frame 0 is the T-pose, which is exactly full height).
  let minU = Infinity;
  let maxU = -Infinity;
  for (const p of positions[0]) {
    const h = dot3(p, up);
    minU = Math.min(minU, h);
    maxU = Math.max(maxU, h);
  }
  const figureUnits = Math.max(1e-6, maxU - minU);
  const scale = opts.pxPerUnit ?? (opts.figureHeightPx ?? D.figureHeightPx) / figureUnits;

  const rootJoint = resolve(map.root.joint);
  const travel =
    rootJoint < 0
      ? 0
      : Math.max(
          ...positions.map((p) => {
            const d = sub3(p[rootJoint], refPos(rootJoint));
            return Math.hypot(d[0] - up[0] * dot3(d, up), d[1] - up[1] * dot3(d, up), d[2] - up[2] * dot3(d, up));
          }),
        );
  const motionMode =
    opts.motion === undefined || opts.motion === 'auto'
      ? travel > D.travelFrac * figureUnits
        ? 'locomotion'
        : 'stationary'
      : opts.motion;

  // Wall-clock seconds each BAKED frame spans, so stance thresholds mean the
  // same thing whether a clip bakes to 8 frames or 24. A file with no usable
  // Frame Time falls back to 30fps rather than making every foot "still".
  const dtSrc = bvh.frameTime > 0 ? bvh.frameTime : 1 / 30;
  const secondsPerFrame = outCount > 1 ? (dtSrc * span) / (outCount - 1) : dtSrc;

  const ctx: BuildCtx = {
    positions,
    N,
    up,
    fwd,
    scale,
    refPos,
    resolve,
    motionMode,
    opts,
    figureUnits,
    rootJoint,
    secondsPerFrame,
  };
  return {
    down: buildFacing('down', map, ctx),
    up: buildFacing('up', map, ctx),
    left: buildFacing('left', map, ctx),
  };
}

interface BuildCtx {
  positions: Vec3[][];
  N: number;
  up: Vec3;
  fwd: Vec3;
  scale: number;
  refPos: (j: number) => Vec3;
  resolve: (ref: JointRef) => number;
  motionMode: 'stationary' | 'locomotion';
  opts: BvhImportOptions;
  figureUnits: number;
  rootJoint: number;
  secondsPerFrame: number;
}

function buildFacing(facing: RigFacing, map: BvhBoneMap, ctx: BuildCtx): Clip {
  const fm = map.facings[facing];
  const chips = fm.template.chips;
  const N = ctx.N;
  const u = facingRight(facing, ctx.fwd, ctx.up);
  const projX = (p: Vec3): number => dot3(p, u);
  const projY = (p: Vec3): number => -dot3(p, ctx.up); // screen y runs DOWN

  const chipIndex = new Map(chips.map((c, i) => [c.name, i]));

  // ── Per-chip screen-angle delta from the reference pose ──────────────────
  const chipDelta: (number[] | null)[] = chips.map(() => null);
  const chipJoint: number[] = chips.map(() => -1);
  for (const bone of fm.bones) {
    const ci = chipIndex.get(bone.chip);
    const from = ctx.resolve(bone.from);
    const to = ctx.resolve(bone.to);
    if (ci === undefined || from < 0 || to < 0) continue;
    chipJoint[ci] = from;

    const abs = new Array<number>(N);
    let prev = Number.NaN;
    for (let f = 0; f < N; f++) {
      const d3 = sub3(ctx.positions[f][to], ctx.positions[f][from]);
      const px = projX(d3);
      const py = projY(d3);
      const L = Math.hypot(px, py);
      const L3 = Math.hypot(d3[0], d3[1], d3[2]);
      // Out-of-plane: nothing to read an angle from, so hold the last one.
      abs[f] = L < D.degenerateFrac * L3 ? (Number.isNaN(prev) ? 0 : prev) : unwrap((Math.atan2(py, px) * 180) / Math.PI, prev);
      prev = abs[f];
    }
    const zero = refAngle(abs, ctx);
    chipDelta[ci] = bone.mode === 'translate' ? new Array<number>(N).fill(0) : abs.map((a) => a - zero);
  }
  const rootChip = chipIndex.get(map.root.chip);
  if (rootChip !== undefined && ctx.rootJoint >= 0) chipJoint[rootChip] = ctx.rootJoint;

  // ── Per-frame poses: rotations, then the position residual as dx/dy ──────
  const maxRes = ctx.opts.maxResidualPx ?? D.maxResidualPx;
  const samples: FrameSample[][] = [];
  const worlds: Affine[][] = [];
  for (let f = 0; f < N; f++) {
    const pose: FrameSample[] = [];
    const world: Affine[] = [];
    for (let ci = 0; ci < chips.length; ci++) {
      const ch = chips[ci];
      // Rig FK composes ancestor rotations, so a track carries only what its
      // chip adds: the bone's swing MINUS its rig parent's. (An arm raised 90°
      // with the elbow bent a further 30° emits -90 and -30, never -120.)
      const parentDelta = ch.parent >= 0 ? (chipDelta[ch.parent]?.[f] ?? 0) : 0;
      const deg = (chipDelta[ci]?.[f] ?? 0) - parentDelta;
      const P = ch.parent < 0 ? IDENTITY2D : world[ch.parent];
      const R = rotAbout(ch.pivot[0], ch.pivot[1], deg);
      let dx = 0;
      let dy = 0;
      const jt = chipJoint[ci];
      if (jt >= 0) {
        // Target = where the (scaled) captured joint has moved to since the
        // reference pose, anchored on the chip's own pivot — so BVH-vs-LPC
        // proportion differences cancel and only MOTION is transferred.
        const rp = ctx.refPos(jt);
        const now = ctx.positions[f][jt];
        const tx = ch.pivot[0] + ctx.scale * (projX(now) - projX(rp));
        const ty = ch.pivot[1] + ctx.scale * (projY(now) - projY(rp));
        // world = P · T(d) · R and R fixes the pivot, so d = P⁻¹(target) − pivot
        // (the same solve `applyPlants` does for ground plants).
        const [lx, ly] = applyAffine(invertAffine(P), tx, ty);
        dx = lx - ch.pivot[0];
        dy = ly - ch.pivot[1];
        if (ch.parent >= 0) {
          const L = Math.hypot(dx, dy);
          if (L > maxRes) {
            dx = (dx / L) * maxRes;
            dy = (dy / L) * maxRes;
          }
        }
      }
      let local = R;
      if (dx !== 0 || dy !== 0) local = mulAffine([1, 0, dx, 0, 1, dy], R);
      world[ci] = ch.parent < 0 ? local : mulAffine(P, local);
      pose.push({ deg, dx, dy });
    }
    samples.push(pose);
    worlds.push(world);
  }

  // ── Feet ────────────────────────────────────────────────────────────────
  const feet = fm.feet
    .map((ft) => ({ ft, joint: ctx.resolve(ft.joint), ci: chipIndex.get(ft.chip) }))
    .filter((x): x is { ft: BvhFoot; joint: number; ci: number } => x.joint >= 0 && x.ci !== undefined);
  const stance = detectStance(ctx, feet.map((x) => x.joint));

  let plant: { chip: string; point: [number, number] }[] = [];
  if (ctx.motionMode === 'locomotion') {
    // Root-motion compensation. Every chip sits at its own absolute target, so
    // the trunk's dx does NOT drag its children — but ADDING to the root's dx
    // after the solve does translate the whole figure rigidly (P⁻¹ cancels the
    // shift for every descendant). So: measure where the stance sole actually
    // landed, then slide the figure back so it holds still. Foot-skate control
    // at import time, and it nails the RIG's sole, not just the capture's.
    // That compensation has TWO components and they want opposite things. The
    // per-frame wobble is pure win: it cancels the jitter that makes a planted
    // sole shiver. The net drift is not — nailing the foot advances the BODY
    // across the cell by one stride per cycle (measured: trunk dx reaches
    // +16px on one CMU walk cycle), and a sprite the sim ALREADY translates
    // would lurch forward inside its own cell and snap back at the loop.
    //
    // So 'in-place' (the default, and what the runtime wants) strips the
    // LINEAR component and keeps the residual. The feet then slide by exactly
    // one stride per cycle — which reads as planted precisely when the NPC's
    // ground speed matches the clip's stride/duration. Foot fidelity is a
    // walk-speed tuning knob (M2), not a property of the bake.
    const soleX = feet.map((x) => worlds.map((w) => applyAffine(w[x.ci], x.ft.point[0], x.ft.point[1])[0]));
    const shifts: number[] = [];
    let shift = 0;
    let cur = -1;
    let base = 0;
    let anchor = 0;
    for (let f = 0; f < N; f++) {
      const s = stance.stance[f];
      if (s >= 0 && s !== cur) {
        // Rebase on a stance change so the compensation stays continuous.
        cur = s;
        base = shift;
        anchor = soleX[s][f];
      }
      if (cur >= 0) shift = base - (soleX[cur][f] - anchor);
      shifts.push(shift);
    }
    if (rootChip !== undefined) {
      for (let f = 0; f < N; f++) samples[f][rootChip].dx += shifts[f];
      if ((ctx.opts.rootMotion ?? 'in-place') === 'in-place' && N > 1) {
        // Detrend the root's TOTAL dx, not the compensation alone: the base
        // solve already carries whatever forward travel the capture had, and
        // it is the sum of the two that decides where the body ends up.
        const drift = samples[N - 1][rootChip].dx - samples[0][rootChip].dx;
        for (let f = 0; f < N; f++) samples[f][rootChip].dx -= (drift * f) / (N - 1);
        // Then anchor it. Detrending removes the ramp and leaves the OFFSET,
        // and the offset along the travel axis is not a fact about the pose —
        // it is where the actor happened to be standing in the capture volume.
        //
        // Frontal facings hide this: their travel axis points into the screen,
        // so the leak was ±1px and read as postural lean. The sagittal (west)
        // facing puts the travel axis ON screen x, where the same leak measured
        // +20px — two thirds of the way out of a 64px cell, with the figure
        // clipping the frame edge. Found by rendering it; nothing in the suite
        // had an opinion about absolute position.
        //
        // The anchor is the SAME reference the rotations use, which is the only
        // choice that stays right for both kinds of clip. A cyclic import
        // (`referenceFrame: 'mean'`) anchors on the mean, so re-cutting the same
        // walk at a different phase does not slide the sprite sideways. A
        // gesture anchored on a standing frame keeps that frame at the rig's
        // rest position, so an NPC that transitions idle → wave → idle does not
        // jump: centring the wave instead put its standing pose 3.5px off.
        //
        // `dy` is deliberately left alone: vertical offset from the rest pose is
        // a real postural fact (a crouch is not a camera offset), and it never
        // exceeded a pixel in any capture we have.
        const refMode = ctx.opts.referenceFrame ?? 0;
        let anchorDx = 0;
        if (refMode === 'mean') {
          for (let f = 0; f < N; f++) anchorDx += samples[f][rootChip].dx;
          anchorDx /= N;
        } else anchorDx = samples[Math.max(0, Math.min(refMode, N - 1))][rootChip].dx;
        for (let f = 0; f < N; f++) samples[f][rootChip].dx -= anchorDx;
      }
    }
  } else {
    // Stationary: the rig's own plant nails a point for the WHOLE clip, so a
    // foot earns one only if it is in stance essentially throughout.
    plant = feet
      .filter((_x, k) => stance.flags[k].filter(Boolean).length >= D.stancePlantFrac * N)
      .map((x) => ({ chip: x.ft.chip, point: x.ft.point }));
  }

  // ── Loop closure ────────────────────────────────────────────────────────
  const loop = ctx.opts.loop ?? 'auto';
  let closed = samples;
  // 'wrap' is for a capture trimmed to exactly one period with no repeated
  // frame: append the first pose so t=1 lands back on t=0's pose.
  if (loop === 'wrap') closed = [...samples, samples[0].map((p) => ({ ...p }))];
  if (loop !== 'none') closed = closeLoop(closed);

  // ── Fit + emit ──────────────────────────────────────────────────────────
  const tracks: Record<string, Keyframe[]> = {};
  chips.forEach((ch, ci) => {
    const track = fitTrack(
      closed.map((p) => p[ci]),
      ctx.opts,
    );
    if (track) tracks[ch.name] = track;
  });

  const clip: Clip = { name: ctx.opts.name ?? 'bvh-import', frames: closed.length, tracks };
  if (plant.length > 0) clip.plant = plant;
  return clip;
}

/** The angle every track is measured from: one frame's, or the clip mean. */
function refAngle(abs: readonly number[], ctx: BuildCtx): number {
  const refMode = ctx.opts.referenceFrame ?? 0;
  if (refMode === 'mean') return abs.reduce((s, a) => s + a, 0) / abs.length;
  return abs[Math.max(0, Math.min(refMode, abs.length - 1))];
}

/**
 * Stance per frame: an ankle near the lowest height seen and barely moving.
 * Height and speed are 3D and facing-independent, so a foot means the same
 * thing in every projection.
 */
function detectStance(ctx: BuildCtx, ankles: readonly number[]): { flags: boolean[][]; stance: number[] } {
  const N = ctx.N;
  const flags = ankles.map(() => new Array<boolean>(N).fill(false));
  const stance = new Array<number>(N).fill(-1);
  if (ankles.length === 0) return { flags, stance };

  const height = ankles.map((j) => ctx.positions.map((p) => dot3(p[j], ctx.up)));
  const ground = Math.min(...height.map((h) => Math.min(...h)));
  const hTol = D.stanceHeightFrac * ctx.figureUnits;
  const sTol = D.stanceSpeedPerSec * ctx.figureUnits * ctx.secondsPerFrame;

  for (let k = 0; k < ankles.length; k++) {
    for (let f = 0; f < N; f++) {
      const a = ctx.positions[Math.max(0, f - 1)][ankles[k]];
      const b = ctx.positions[Math.min(N - 1, f + 1)][ankles[k]];
      const dt = Math.min(N - 1, f + 1) - Math.max(0, f - 1);
      const d = sub3(b, a);
      const speed = dt === 0 ? 0 : Math.hypot(d[0], d[1], d[2]) / dt;
      flags[k][f] = height[k][f] - ground <= hTol && speed <= sTol;
    }
  }
  for (let f = 0; f < N; f++) {
    let best = -1;
    for (let k = 0; k < ankles.length; k++) {
      if (flags[k][f] && (best < 0 || height[k][f] < height[best][f])) best = k;
    }
    stance[f] = best;
  }
  return { flags, stance };
}

/**
 * Close a cyclic clip so `t=0` and `t=1` sample identically. Detection is a
 * first-vs-last pose distance; the fix is to bleed the discrepancy out over a
 * TAIL window, which preserves the phase of everything before it (the extremes
 * of the cycle stay where the actor put them). A clip that isn't already close
 * to cyclic is left open — silently reshaping a one-shot into a loop would be
 * the wrong kind of helpful.
 */
function closeLoop(samples: FrameSample[][]): FrameSample[][] {
  const N = samples.length;
  if (N < 2) return samples;
  const first = samples[0];
  const last = samples[N - 1];
  const d = last.map((p, i) => ({ deg: p.deg - first[i].deg, dx: p.dx - first[i].dx, dy: p.dy - first[i].dy }));
  const cyclic = d.every(
    (v) => Math.abs(v.deg) <= D.loopDegTol && Math.abs(v.dx) <= D.loopPxTol && Math.abs(v.dy) <= D.loopPxTol,
  );
  if (!cyclic) return samples;

  const W = Math.max(1, Math.round((N - 1) * D.loopTailFrac));
  const start = N - 1 - W;
  return samples.map((pose, f) => {
    if (f <= start) return pose;
    const w = (f - start) / W;
    return pose.map((p, i) => ({ deg: p.deg - w * d[i].deg, dx: p.dx - w * d[i].dx, dy: p.dy - w * d[i].dy }));
  });
}

/**
 * Greedy error-driven keyframe fit. Start with the endpoints, then keep
 * inserting the worst frame until nothing deviates past tolerance (or the cap
 * is hit). Reconstruction goes through the rig's OWN `sampleTrack`, smoothstep
 * and all, so the error being minimized is the one the bake will actually show.
 * Returns null for a track that quantizes to nothing.
 */
function fitTrack(series: readonly FrameSample[], opts: BvhImportOptions): Keyframe[] | null {
  const N = series.length;
  const degTol = opts.degTol ?? D.degTol;
  const pxTol = opts.pxTol ?? D.pxTol;
  const maxKeys = opts.maxKeys ?? D.maxKeys;

  const useDeg = series.some((s) => Math.abs(quant(s.deg, D.degQuantum)) > 0);
  const useDx = series.some((s) => Math.abs(quant(s.dx, D.pxQuantum)) > 0);
  const useDy = series.some((s) => Math.abs(quant(s.dy, D.pxQuantum)) > 0);
  if (!useDeg && !useDx && !useDy) return null;

  const build = (idx: readonly number[]): Keyframe[] =>
    idx.map((f) => ({ t: N === 1 ? 0 : f / (N - 1), deg: series[f].deg, dx: series[f].dx, dy: series[f].dy }));

  const keys: number[] = N === 1 ? [0] : [0, N - 1];
  for (;;) {
    if (keys.length >= maxKeys || keys.length >= N) break;
    const track = build(keys);
    let worst = -1;
    let worstErr = 1;
    for (let f = 0; f < N; f++) {
      if (keys.includes(f)) continue;
      const got = sampleTrack(track, f / (N - 1));
      const err = Math.max(
        Math.abs(got.deg - series[f].deg) / degTol,
        Math.abs(got.dx - series[f].dx) / pxTol,
        Math.abs(got.dy - series[f].dy) / pxTol,
      );
      if (err > worstErr) {
        worstErr = err;
        worst = f;
      }
    }
    if (worst < 0) break;
    keys.push(worst);
    keys.sort((a, b) => a - b);
  }

  // Fixed key order (t, deg, dx, dy) and fixed omission rules — byte stability
  // is part of the contract, so the shape of the output can't depend on chance.
  return keys.map((f) => {
    const k: Keyframe = { t: N === 1 ? 0 : f / (N - 1), deg: useDeg ? quant(series[f].deg, D.degQuantum) : 0 };
    if (useDx) k.dx = quant(series[f].dx, D.pxQuantum);
    if (useDy) k.dy = quant(series[f].dy, D.pxQuantum);
    return k;
  });
}
