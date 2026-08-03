/**
 * Author-time BVH → rig clip importer. Free, offline, no API calls, no spend.
 *
 *   npx tsx scripts/motion-import-bvh.ts --plan        # print what it WOULD emit, write nothing
 *   npx tsx scripts/motion-import-bvh.ts               # (re)emit every clip module
 *   npx tsx scripts/motion-import-bvh.ts walk wave     # only these ids
 *
 * Read-only diagnostics — how a `range` and a `frames` get CHOSEN, so the next
 * capture can be judged the same way instead of on somebody's memory:
 *
 *   … 104_02.bvh --contacts                  # footfalls → candidate gait cycles
 *   … 104_02.bvh --periods --from 214        # which cycle length actually closes
 *   … walk --sweep                           # decimation error vs frame count
 *   … walk --in-plane                        # per-bone foreshortening
 *   … 138_01.bvh --in-plane --range 361,509 --frames 9   # …for a capture NOT in the table
 *
 * THE GENERATED MODULES ARE THE ARTIFACT. Nothing at runtime ever opens a
 * `.bvh`: this script reads the vendored CMU captures once, at author time, and
 * writes checked-in TypeScript `Clip` modules under `src/render/paperdoll/clips/`.
 * Determinism is a spec contract (spec contract 2) — same capture + same options
 * → byte-identical output, pinned by `tests/unit/motion-import-determinism.test.ts`,
 * which re-runs this module's own emit and diffs it against the checked-in bytes.
 *
 * WHAT THIS SCRIPT OWNS THAT THE IMPORTER DOES NOT — the per-clip decisions
 * `projectToRig` cannot make for itself, each measured rather than guessed:
 *
 * - `range` IS THE CYCLE, and picking it well matters more than any tolerance.
 *   Each locomotion range below is one gait cycle found empirically: successive
 *   same-foot contacts cross-checked against the period that minimizes the RMS
 *   hips-relative joint distance between the range's first and last frame (that
 *   residual is quoted per clip as `loop residual` — it is what `closeLoop` then
 *   has to absorb). Gesture ranges are the whole gesture, start and end picked
 *   at frames where the actor is still.
 *
 * - `frames` IS THE DECIMATOR. 120 fps is trimmed by `range` and point-sampled
 *   onto this count; the keyframe fitter never decimates. Counts are 2^k+1 so
 *   the emitted `t` values are exact binary fractions (0.125, 0.25, …) rather
 *   than 0.14285714285714285 — one less way for bytes to wobble. A cyclic clip
 *   at `frames: 9` is 8 distinct phases at exact 1/8-cycle spacing PLUS the
 *   closing duplicate that makes `t=1` sample identically to `t=0`; an
 *   LPC-style 8-column row is frames 0..7. GOTCHA: a gesture faster than half
 *   the baked rate ALIASES — the angle unwrapper cannot tell +200° from −160°.
 *
 * - `maxKeys` IS THE SECOND SAMPLING LIMIT, and it is easy to miss because it
 *   looks like a size knob. The fitter compresses the baked poses into at most
 *   `maxKeys` keys per track; a clip carrying MORE extrema than that (the wave
 *   has ~7 oscillations, i.e. ~14) has the surplus smoothed away no matter how
 *   finely `range` was sampled. Symptom: decimation error that PLATEAUS as
 *   `frames` rises instead of converging. `--sweep` shows the difference in one
 *   table, which is why choosing these two is a measurement, not a taste call.
 *
 *   Every emitted header quotes the decimation error against an undecimated
 *   bake of the same range, and the determinism suite refuses a clip past 8°
 *   RMS or a per-frame angle step past 180°. The fix when either fires is a
 *   tighter `range`, more `frames`, or more `maxKeys` — never looser tolerances.
 *
 * - `referenceFrame` — frame 0 of every file in this corpus is a SYNTHETIC
 *   T-POSE the cgspeed converter prepended, not capture data, so the importer's
 *   default (`0`) would read every standing pose as "arms swung 90° down".
 *   Cyclic clips use `'mean'`; one-shots start their range on a standing frame
 *   and use `0` (which indexes the SAMPLED frames, i.e. the range start).
 *
 * - `pxPerUnit` is pinned to the T-POSE, not left to the importer's default.
 *   The default measures the figure on the first SAMPLED frame, which for a
 *   `range` that starts mid-stride is a walking pose ~5% shorter than standing
 *   (measured: 24.24 vs 25.50 units on 07_01) — so two clips off one subject
 *   would land at two different scales. Anchoring on frame 0's full standing
 *   extent makes the scale a property of the SKELETON, not of the trim.
 *
 * Root motion stays `'in-place'` (the importer default): our sprites are already
 * translated by the sim, so the body must come home each cycle and the feet slide
 * one stride instead. That makes foot fidelity a WALK-SPEED tuning knob, which is
 * why every locomotion clip's header carries its implied ground speed.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  HUMANOID_BVH_MAP,
  fkPositions,
  parseBvh,
  projectToRig,
  type BvhClip,
  type BvhImportOptions,
  type RigFacing,
} from '../src/render/paperdoll/bvh';
import { sampleClip, type AnimTemplate, type ChipPose, type Clip, type Keyframe } from '../src/render/paperdoll/rig';
import { LPC_HUMANOID_SOUTH } from '../src/render/paperdoll/lpc-humanoid';
import { LPC_HUMANOID_NORTH } from '../src/render/paperdoll/lpc-humanoid-north';
import { LPC_HUMANOID_WEST } from '../src/render/paperdoll/lpc-humanoid-west';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CAPTURES = join(ROOT, 'vendor/mocap/cmu');
export const CLIPS_DIR = join(ROOT, 'src/render/paperdoll/clips');

/** LPC figure height in cell px: head top (y 11) to sole (y 62). */
const FIGURE_HEIGHT_PX = 51;

const FACINGS = ['down', 'up', 'left'] as const;

/** The template each facing's clip is authored against — same map as `bvh.ts`. */
const TEMPLATES: Record<RigFacing, AnimTemplate> = {
  down: LPC_HUMANOID_SOUTH,
  up: LPC_HUMANOID_NORTH,
  left: LPC_HUMANOID_WEST,
};

export interface ImportSpec {
  /** Clip name, module basename, and the CLI filter token. ASCII, kebab-case. */
  id: string;
  /** Capture filename under `vendor/mocap/cmu/`. */
  source: string;
  /** One line on what the capture is and how this range was found. */
  note: string;
  /** Everything `projectToRig` is told, minus `name`/`pxPerUnit` (derived here). */
  opts: BvhImportOptions & { range: [number, number]; frames: number };
  /**
   * Per-facing `Clip.skinBand` override, `down`/`up` only. West already carries
   * its own band on `LPC_HUMANOID_WEST` (every clip it bakes needs it — see
   * that template's doc comment); the frontal templates are deliberately RIGID
   * because they hinge fine for the shipped `pray-raise`/`idle-shift` and only
   * this clip's forearm swing goes far enough to tear. See `Clip.skinBand`'s
   * doc comment in `rig.ts` for why the override lives on the CLIP here rather
   * than the template.
   */
  skinBand?: Partial<Record<'down' | 'up', number>>;
}

/**
 * The clip table. Every `range` here is measured, not guessed, and each `note`
 * records BOTH the number and how it was obtained (successive same-foot stance
 * onsets, and the period minimizing the first/last hips-relative pose distance).
 * Both searches are checked in as `--contacts` and `--periods`, so a range for
 * a capture we add later is re-derivable rather than remembered; `--sweep` and
 * `--in-plane` do the same for `frames`/`maxKeys` and for whether a capture is
 * importable at all.
 *
 * A capture with no defensible trim is ABSENT rather than imported badly; see
 * the CAPTURES MEASURED, THEN DECLINED block below.
 */
export const MOTION_IMPORTS: readonly ImportSpec[] = [
  {
    id: 'walk',
    source: '104_02.bvh',
    note:
      'neutral-male walk. One gait cycle between successive LEFT heel strikes ' +
      '(stance runs start 214 and 363); 147 frames also minimizes the first/last ' +
      'pose distance over 110..200, so the loop closes on measurement, not on hope.',
    opts: { range: [214, 361], frames: 9, referenceFrame: 'mean' },
  },
  {
    id: 'walk-brisk',
    source: '07_01.bvh',
    note:
      'a faster walk by the same measure — 0.6 s per step against 104_02\'s 0.7 s, ' +
      'and a stride 32% longer. Cycle from the RIGHT heel strike at 130; 127 frames ' +
      'is the pose-distance minimum over 90..180 (the foot-contact spacing says 131, ' +
      'and the 4-frame disagreement is the capture decelerating slightly).',
    opts: { range: [130, 257], frames: 9, referenceFrame: 'mean' },
  },
  {
    id: 'wave',
    source: '141_16.bvh',
    note:
      'wave hello — a ONE-SHOT, not a loop. Range is the whole gesture: arm hanging ' +
      'at frame 1, up by ~35, waving until ~200, down and settled by ~240. Reference ' +
      'frame 0 is therefore the actor STANDING (the range start), which is what the ' +
      'rig rest cell should mean. ' +
      'THE RANGE CANNOT BE TIGHTENED to "just the waving", and that is a constraint ' +
      'rather than a preference: referenceFrame indexes the SAMPLED frames, so the ' +
      'rest pose has to lie inside the range, and the only standing pose in the ' +
      'capture is at the start. Trim to the oscillation alone and the reference ' +
      'becomes an arms-up pose — the raise, which is the whole readable gesture at ' +
      '64 px, would vanish. ' +
      'SO THE SAMPLING WAS FIXED INSTEAD, and it took two knobs, not one. The wave ' +
      'proper is a 24-frame forearm oscillation, so 33 frames puts the spacing at ' +
      '7.8 source frames (3.1 samples per oscillation, clear of Nyquist). That alone ' +
      'changed nothing — because the SECOND limit was the keyframe cap: seven ' +
      'oscillations cannot be described in 12 keys, so the fitter smoothed the wave ' +
      'away no matter how finely the range was sampled, and the error sat at ~12 deg ' +
      'RMS from 17 frames all the way to 65. Lifting maxKeys to 24 with frames at 33 ' +
      'drops it to 4.8 deg RMS / 13.8 deg peak — better than the walk at 9 frames ' +
      '(5.6 / 19.4), and the plateau is gone. The two knobs are measurable with ' +
      '`--sweep`; a bake at 9 frames still winds the forearm to -359 deg, which is ' +
      'why neither is a free dial.',
    opts: { range: [1, 250], frames: 33, maxKeys: 24, referenceFrame: 0, loop: 'none' },
    // The frontal `armL_fore`/`armR_fore` swing past 150° here (vs. `pray-raise`'s
    // clean 112°), well beyond what LPC_HUMANOID_SOUTH/_NORTH's rigid arm chips
    // hinge cleanly at — the outer lateral column tears loose past ~1px of
    // rotation-carried travel, same mechanism as the west leg (`lpc-humanoid-
    // west.ts`), different chip. Swept bands 1–10 (RAW bake, whole clip,
    // `fragmentation`): band 1 alone already closes both literal (alpha=0)
    // tears this clip has at the shoulder/elbow (south armR_up's rest-pose hole,
    // north armL_up's) and cuts total hole count roughly in half (south 235→127,
    // north 132→41→35); bands 2–3 buy a further few px at the noise floor.
    // Bands ≥4 look better on the aggregate count but get there by widening the
    // gap between the legs until it merges with the outer silhouette — a
    // DIFFERENT defect (thinned material reclassified as "not a hole" rather
    // than actually filled), not a bigger fix, and exactly the failure mode a
    // margin risked on the west leg. 1 is the smallest band that closes the
    // named tear without smearing the sleeve; the residual hip-adjacent hole is
    // real but unrelated to the arm chips this clip's defect report was about.
    skinBand: { down: 1, up: 1 },
  },
];

/*
 * CAPTURES MEASURED, THEN DECLINED. A clip that cannot be justified is worse
 * than a clip that does not exist. Every number below is reproducible from this
 * file: `describeInPlane` prints the foreshortening, and the cycle/energy
 * figures come from the same FK the importer runs.
 *
 * - `138_01.bvh` march and `79_04.bvh` digging — both have a CLEAN SAGITTAL
 *   read and an unusable FRONTAL one, and the rig cannot ship half a clip.
 *   Trimmed (march: 148 frames from 361, travelling 0.76 figure heights per
 *   cycle; dig: 148 frames from 540, in place) both close their loops well.
 *   But their arms leave the coronal plane, so in the down/up facings the
 *   forearm bone projects to a stub whose screen angle is mostly noise:
 *   in-plane length fraction falls to 0.33 (march `armL_fore`, mean 0.64) and
 *   0.22 (dig `armR_fore`, mean 0.72) — against 0.98/0.93 for the same bones
 *   in profile. The importer only HOLDS an angle below 0.15, so what comes out
 *   is a forearm swinging ±94° (march) and ±107° (dig) across the body: a
 *   visible flail, not a march or a dig. The walks stay clean on the same
 *   measure (worst frontal step 14° and 24°) because their arms hang in-plane.
 *   THE FIX IS A BONE-MAP DECISION, NOT A TOLERANCE: give the frontal forearm
 *   bones `mode: 'translate'` in `HUMANOID_BVH_MAP`, exactly the rule the head
 *   already follows there ("an in-plane head rotation reads as a sideways tilt,
 *   so a frontal nod is faked with translation"). That is deliberately NOT done
 *   here — it changes what `bvh-import.test.ts` pins about parent-relative
 *   elbow bend, so it is a change to judge in the motion studio (M2), not to
 *   smuggle in from a script.
 *
 * - `62_07.bvh` "hammering a nail". There is no hammering in it to import. Peak
 *   hand motion over any half-second window is 0.20 figure heights of total path
 *   length (the walks run 3–5× that), the left hand parks at a single point for
 *   ~600 frames (holding the nail) and the right hand's whole-capture excursion
 *   is under 1 unit on a 27-unit figure. At 51 px that is a sub-2 px tremor.
 *   A work loop has to be re-captured or hand-keyed; it is not in this file.
 *
 * - `05_02.bvh` dance. Energetic (peak 0.56, the highest in the corpus) but not
 *   periodic on any window tried: the best first/last pose distance in the busy
 *   section is 0.22 figure heights against a 0.39 spread — i.e. barely better
 *   than two random frames. It is choreography, not a cycle, and trimming it to
 *   a loop would be inventing one.
 */

// ── emit ────────────────────────────────────────────────────────────────────

export interface FacingMetrics {
  facing: RigFacing;
  /** Number of chips that got a track at all. */
  tracks: number;
  /** Largest |deg| any track reaches. */
  maxDeg: number;
  /** Largest |deg| STEP between consecutive baked frames — the aliasing tell. */
  maxStepDeg: number;
  /** Chip the worst step belongs to. */
  maxStepChip: string;
  /** Max |pose difference| between t=0 and t=1, degrees — 0 for a closed loop. */
  loopDeg: number;
  /** Chips whose sole this clip nails for its whole length. */
  plants: number;
  /**
   * Smallest fraction of any rotating bone's 3D length that SURVIVES this
   * facing's projection, over the baked frames — the foreshortening floor.
   * Near 1 the screen angle is the bone's real angle; near 0 the bone points
   * at the camera and its angle is noise the rig will happily windmill on.
   */
  minInPlane: number;
  /** Bone chip the floor belongs to. */
  minInPlaneChip: string;
}

export interface ClipMetrics {
  /** Source frames spanned by `range`. */
  cycleFrames: number;
  cycleSeconds: number;
  /** px per BVH unit, pinned to the T-pose (see the module header). */
  pxPerUnit: number;
  /** T-pose vertical extent in BVH units. */
  tposeUnits: number;
  /** Horizontal root displacement across the range, in cell px. */
  stridePx: number;
  /** stridePx / cycleSeconds — what an NPC must move at for planted feet. */
  groundSpeedPxPerSec: number;
  /** RMS hips-relative joint offset between the range's first and last frame, px. */
  loopResidualPx: number;
  /** Source frames between baked samples — the decimation, stated as a number. */
  sampleSpacingFrames: number;
  /** Wall-clock ms one baked frame covers. Compare against the player cadence. */
  msPerFrame: number;
  /** Worst chip's gap from an undecimated bake of the same range. */
  decimation: DecimationError | null;
  facings: FacingMetrics[];
  /**
   * Whether every facing samples identically at t=0 and t=1 — MEASURED on the
   * emitted clips, not read back off `opts.loop`. `'auto'` means the importer
   * decided, and what it decided is exactly what a player would see pop.
   */
  loops: boolean;
}

const readCapture = (source: string): BvhClip =>
  parseBvh(readFileSync(join(CAPTURES, source), 'utf8'));

/** Vertical extent of a source frame, in BVH units. */
function verticalExtent(bvh: BvhClip, frame: number): number {
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of fkPositions(bvh, bvh.frames[frame])) {
    lo = Math.min(lo, p[1]);
    hi = Math.max(hi, p[1]);
  }
  return hi - lo;
}

const round = (v: number, dp: number): number => Number(v.toFixed(dp));

// ── foreshortening diagnostic ───────────────────────────────────────────────

type Vec3 = [number, number, number];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const unit = (a: Vec3): Vec3 => {
  const L = Math.hypot(a[0], a[1], a[2]);
  return L > 0 ? [a[0] / L, a[1] / L, a[2] / L] : [0, 0, 0];
};
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export interface BoneInPlane {
  chip: string;
  min: number;
  mean: number;
  /** Per-baked-frame fractions, in order. */
  frames: number[];
}

interface ProjCtx {
  bvh: BvhClip;
  /** FK at the BAKED sample frames, in order. */
  baked: Vec3[][];
  /** FK at every SOURCE frame of the range, in order. */
  source: Vec3[][];
  resolve: (ref: string | readonly string[]) => number;
  up: Vec3;
  rightOf: (facing: RigFacing) => Vec3;
}

/**
 * Shared projection setup for the diagnostics below.
 *
 * HONEST DUPLICATION: the sampling, world-up, forward guess and per-facing
 * screen-right here MIRROR `projectToRig`'s internals, which are private to
 * `bvh.ts`. They can drift. Everything built on this is diagnostic output only
 * — nothing emitted depends on it — and a drift shows up immediately as
 * numbers that no longer explain the tracks beside them.
 */
function projectionContext(spec: ImportSpec): ProjCtx {
  const bvh = readCapture(spec.source);
  const [r0, r1] = spec.opts.range;
  const span = r1 - r0;
  const n = Math.max(1, Math.min(spec.opts.frames, span + 1));
  const src: number[] = [];
  for (let f = 0; f < n; f++) src.push(n === 1 ? r0 : r0 + Math.round((f * span) / (n - 1)));
  const baked = src.map((f) => fkPositions(bvh, bvh.frames[f]));
  const source: Vec3[][] = [];
  for (let f = r0; f <= r1; f++) source.push(fkPositions(bvh, bvh.frames[f]));

  const index = new Map<string, number>();
  bvh.joints.forEach((j, k) => {
    if (!index.has(j.name)) index.set(j.name, k);
  });
  const resolve = (ref: string | readonly string[]): number => {
    for (const nm of typeof ref === 'string' ? [ref] : ref) {
      const k = index.get(nm);
      if (k !== undefined) return k;
    }
    return -1;
  };

  const up: Vec3 = [0, 1, 0];
  const refPos = (j: number): Vec3 => {
    if (spec.opts.referenceFrame !== 'mean') {
      return baked[Math.max(0, Math.min(spec.opts.referenceFrame ?? 0, n - 1))][j];
    }
    const s: Vec3 = [0, 0, 0];
    for (const p of baked) {
      s[0] += p[j][0];
      s[1] += p[j][1];
      s[2] += p[j][2];
    }
    return [s[0] / n, s[1] / n, s[2] / n];
  };
  const li = resolve(HUMANOID_BVH_MAP.lateral[0]);
  const ri = resolve(HUMANOID_BVH_MAP.lateral[1]);
  let fwd = li >= 0 && ri >= 0 ? unit(cross(up, sub(refPos(ri), refPos(li)))) : ([0, 0, -1] as Vec3);
  fwd = unit([fwd[0] - up[0] * dot(fwd, up), fwd[1] - up[1] * dot(fwd, up), fwd[2] - up[2] * dot(fwd, up)]);
  const rightOf = (facing: RigFacing): Vec3 =>
    facing === 'down' ? unit(cross(up, fwd)) : facing === 'up' ? unit(cross(fwd, up)) : [-fwd[0], -fwd[1], -fwd[2]];

  return { bvh, baked, source, resolve, up, rightOf };
}

/**
 * How much of each bone survives the projection, per facing — the CAUSE behind
 * a windmilling chip, where the emitted track only shows the symptom. This is
 * what decides whether a capture is importable at all (see the declined block
 * above), so it lives here rather than in a throwaway probe.
 */
export function inPlaneFractions(spec: ImportSpec): Record<RigFacing, BoneInPlane[]> {
  const ctx = projectionContext(spec);
  const out = {} as Record<RigFacing, BoneInPlane[]>;
  for (const facing of FACINGS) {
    const u = ctx.rightOf(facing);
    const bones: BoneInPlane[] = [];
    for (const bone of HUMANOID_BVH_MAP.facings[facing].bones) {
      if (bone.mode === 'translate') continue; // never rotated: foreshortening is moot
      const a = ctx.resolve(bone.from);
      const b = ctx.resolve(bone.to);
      if (a < 0 || b < 0) continue;
      const fr = ctx.baked.map((p) => {
        const d = sub(p[b], p[a]);
        const L3 = Math.hypot(d[0], d[1], d[2]);
        return L3 > 0 ? Math.hypot(dot(d, u), dot(d, ctx.up)) / L3 : 1;
      });
      bones.push({
        chip: bone.chip,
        min: round(Math.min(...fr), 2),
        mean: round(fr.reduce((s, v) => s + v, 0) / fr.length, 2),
        frames: fr.map((v) => round(v, 2)),
      });
    }
    out[facing] = bones;
  }
  return out;
}

// ── the sampling-rate diagnostic ────────────────────────────────────────────

export interface DecimationError {
  facing: RigFacing;
  chip: string;
  /** RMS gap between the shipped clip and an undecimated bake, degrees. */
  rmsDeg: number;
  /** Worst single-frame gap, degrees. */
  maxDeg: number;
}

/**
 * What the decimation COST, measured rather than argued.
 *
 * The obvious check — "is the sample spacing under half the fastest oscillation
 * period?" — needs a period, and a limb angle is never one clean frequency: the
 * wave's forearm carries a whole-gesture arc AND a 5 Hz rider, and any single
 * "the period" for that series is a guess. So instead of estimating a period,
 * re-import the SAME range at source rate (`frames` = every frame, keyframe cap
 * lifted, tolerances tightened) and ask how far the shipped clip sits from it.
 *
 * That reference bake comes out of `projectToRig` itself, so this compares the
 * shipped clip against the real code path rather than a re-derivation — and it
 * catches aliasing exactly: an under-sampled wiggle reconstructs to the wrong
 * shape and the error is large, while a well-sampled one is small no matter how
 * many frequencies the limb carries.
 *
 * Series are mean-centred before comparison: with `referenceFrame: 'mean'` the
 * two bakes average over different sample sets, so a constant offset between
 * them is an artifact of the comparison, not decimation loss. Shape is the
 * question.
 */
export function decimationError(spec: ImportSpec, clips: Record<RigFacing, Clip>): DecimationError | null {
  const bvh = readCapture(spec.source);
  const [r0, r1] = spec.opts.range;
  const span = r1 - r0;
  if (span < 2) return null;
  const reference = projectToRig(bvh, HUMANOID_BVH_MAP, {
    ...spec.opts,
    name: spec.id,
    pxPerUnit: FIGURE_HEIGHT_PX / verticalExtent(bvh, 0),
    frames: span + 1,
    maxKeys: span + 1,
    degTol: 0.05,
    pxTol: 0.05,
  });

  let worst: DecimationError | null = null;
  for (const facing of FACINGS) {
    const template = TEMPLATES[facing];
    const shipped = clips[facing];
    const ref = reference[facing];
    // Sample each clip ONCE per frame: `sampleClip` poses the whole template,
    // so asking it per chip would redo every other chip's work chips-times over.
    const poseA: ChipPose[][] = [];
    const poseB: ChipPose[][] = [];
    for (let f = 0; f <= span; f++) {
      const t = f / span;
      poseA.push(sampleClip(template, shipped, t));
      poseB.push(sampleClip(template, ref, t));
    }
    template.chips.forEach((ch, ci) => {
      if (shipped.tracks[ch.name] === undefined && ref.tracks[ch.name] === undefined) return;
      let meanA = 0;
      let meanB = 0;
      for (let f = 0; f <= span; f++) {
        meanA += poseA[f][ci].deg;
        meanB += poseB[f][ci].deg;
      }
      meanA /= span + 1;
      meanB /= span + 1;
      let sq = 0;
      let mx = 0;
      for (let f = 0; f <= span; f++) {
        const e = Math.abs(poseA[f][ci].deg - meanA - (poseB[f][ci].deg - meanB));
        sq += e * e;
        mx = Math.max(mx, e);
      }
      const rms = Math.sqrt(sq / (span + 1));
      if (worst === null || rms > worst.rmsDeg) {
        worst = { facing, chip: ch.name, rmsDeg: round(rms, 1), maxDeg: round(mx, 1) };
      }
    });
  }
  return worst;
}

// ── the range-finding probes (how a `range` gets chosen at all) ─────────────

export interface StanceRun {
  joint: string;
  from: number;
  to: number;
}

/**
 * Stance runs per ankle over a WHOLE capture, using the importer's own stance
 * rule (an ankle near the lowest height seen, moving slowly). Successive runs
 * of the SAME foot are successive footfalls, and the gap between their onsets
 * is one gait cycle — which is how every locomotion `range` in the table above
 * was found. Checked in rather than kept as a probe: without it nobody can
 * derive a range for a capture we add later.
 */
export function stanceRuns(source: string, minRun = 8): StanceRun[] {
  const bvh = readCapture(source);
  // Frame 0 is the synthetic T-pose — never capture data, so never a footfall.
  const pos: Vec3[][] = [];
  for (let f = 1; f < bvh.frames.length; f++) pos.push(fkPositions(bvh, bvh.frames[f]));
  const N = pos.length;
  const index = new Map<string, number>();
  bvh.joints.forEach((j, k) => {
    if (!index.has(j.name)) index.set(j.name, k);
  });
  const figureUnits = verticalExtent(bvh, 0);
  const dt = bvh.frameTime > 0 ? bvh.frameTime : 1 / 30;

  const ankles = FACINGS.flatMap((f) => HUMANOID_BVH_MAP.facings[f].feet.map((ft) => ft.joint));
  const names = [...new Set(ankles.map((r) => (typeof r === 'string' ? r : r[0])))].sort();
  const heights = names.map((n) => pos.map((p) => p[index.get(n)!][1]));
  const ground = Math.min(...heights.map((h) => Math.min(...h)));

  const out: StanceRun[] = [];
  names.forEach((name, k) => {
    const j = index.get(name)!;
    let start = -1;
    for (let f = 0; f < N; f++) {
      const a = pos[Math.max(0, f - 1)][j];
      const b = pos[Math.min(N - 1, f + 1)][j];
      const steps = Math.min(N - 1, f + 1) - Math.max(0, f - 1);
      const d = sub(b, a);
      const speed = steps === 0 ? 0 : Math.hypot(d[0], d[1], d[2]) / (steps * dt) / figureUnits;
      const on = heights[k][f] - ground <= 0.06 * figureUnits && speed <= 0.4;
      if (on && start < 0) start = f;
      if (!on && start >= 0) {
        if (f - start >= minRun) out.push({ joint: name, from: start + 1, to: f });
        start = -1;
      }
    }
    if (start >= 0 && N - start >= minRun) out.push({ joint: name, from: start + 1, to: N });
  });
  return out.sort((x, y) => x.from - y.from);
}

export interface PeriodCandidate {
  frames: number;
  seconds: number;
  /** RMS hips-relative joint offset between frame `from` and `from + p`, px. */
  poseDistancePx: number;
  /** Horizontal root travel over the candidate period, in cell px. */
  travelPx: number;
}

/**
 * Candidate cycle lengths from a start frame, ranked by how nearly the pose at
 * `from + p` reproduces the pose at `from`. The winner is the `range` end: a
 * cycle chosen this way closes on measurement rather than on a foot-contact
 * eyeball, and its `poseDistancePx` is exactly what `closeLoop` must absorb.
 */
export function periodCandidates(source: string, from: number, min: number, max: number): PeriodCandidate[] {
  const bvh = readCapture(source);
  const index = new Map<string, number>();
  bvh.joints.forEach((j, k) => {
    if (!index.has(j.name)) index.set(j.name, k);
  });
  const hips = index.get(typeof HUMANOID_BVH_MAP.root.joint === 'string' ? HUMANOID_BVH_MAP.root.joint : 'Hips')!;
  const pxPerUnit = FIGURE_HEIGHT_PX / verticalExtent(bvh, 0);
  const base = fkPositions(bvh, bvh.frames[from]);

  const out: PeriodCandidate[] = [];
  for (let p = min; p <= max && from + p < bvh.frames.length; p++) {
    const now = fkPositions(bvh, bvh.frames[from + p]);
    let sum = 0;
    for (let j = 1; j < base.length; j++) {
      for (let k = 0; k < 3; k++) sum += (base[j][k] - base[hips][k] - (now[j][k] - now[hips][k])) ** 2;
    }
    out.push({
      frames: p,
      seconds: round(p * bvh.frameTime, 4),
      poseDistancePx: round(Math.sqrt(sum / (base.length - 1)) * pxPerUnit, 3),
      travelPx: round(Math.hypot(now[hips][0] - base[hips][0], now[hips][2] - base[hips][2]) * pxPerUnit, 1),
    });
  }
  return out.sort((a, b) => a.poseDistancePx - b.poseDistancePx);
}

/**
 * The emitted artifact and nothing else: the three facing clips.
 *
 * Separate from `runImport` because this is the whole determinism surface — the
 * only thing that gets serialized — while the metrics beside it are diagnostics
 * that cost an undecimated reference bake to compute. A caller checking that the
 * importer is reproducible wants this; a caller writing a module wants both.
 */
export function importClips(spec: ImportSpec): Record<RigFacing, Clip> {
  const bvh = readCapture(spec.source);
  return projectToRig(bvh, HUMANOID_BVH_MAP, {
    ...spec.opts,
    name: spec.id,
    pxPerUnit: FIGURE_HEIGHT_PX / verticalExtent(bvh, 0),
  });
}

/**
 * Run one spec. Returns the three facing clips plus the numbers that justify
 * them — the same call the determinism test makes, so what the test compares is
 * what the script wrote, not a re-implementation of it.
 */
export function runImport(spec: ImportSpec): { clips: Record<RigFacing, Clip>; metrics: ClipMetrics } {
  const bvh = readCapture(spec.source);
  const [lo, hi] = spec.opts.range;
  const tposeUnits = verticalExtent(bvh, 0);
  const pxPerUnit = FIGURE_HEIGHT_PX / tposeUnits;

  const clips = importClips(spec);

  // Ground truth for M2: how far the ROOT actually travelled over the cycle.
  // Measured on the capture, not on the bake — the bake deliberately throws
  // this travel away (`rootMotion: 'in-place'`), which is precisely why the
  // number has to be recorded somewhere a human will find it.
  const first = fkPositions(bvh, bvh.frames[lo]);
  const last = fkPositions(bvh, bvh.frames[hi]);
  const hips = HUMANOID_BVH_MAP.root.joint;
  const hipIdx = bvh.joints.findIndex((j) => j.name === (typeof hips === 'string' ? hips : hips[0]));
  const travelUnits = Math.hypot(last[hipIdx][0] - first[hipIdx][0], last[hipIdx][2] - first[hipIdx][2]);
  const cycleFrames = hi - lo;
  const cycleSeconds = cycleFrames * bvh.frameTime;
  const stridePx = travelUnits * pxPerUnit;

  // Loop residual: RMS hips-relative joint displacement first→last, in cell px.
  let sum = 0;
  for (let j = 1; j < first.length; j++) {
    for (let k = 0; k < 3; k++) {
      const a = first[j][k] - first[hipIdx][k];
      const b = last[j][k] - last[hipIdx][k];
      sum += (a - b) ** 2;
    }
  }
  const loopResidualPx = Math.sqrt(sum / (first.length - 1)) * pxPerUnit;
  const inPlane = inPlaneFractions(spec);
  const baked = Math.max(1, Math.min(spec.opts.frames, cycleFrames + 1));
  const sampleSpacingFrames = baked > 1 ? cycleFrames / (baked - 1) : cycleFrames;

  return {
    clips,
    metrics: {
      cycleFrames,
      cycleSeconds: round(cycleSeconds, 4),
      pxPerUnit: round(pxPerUnit, 6),
      tposeUnits: round(tposeUnits, 3),
      stridePx: round(stridePx, 1),
      groundSpeedPxPerSec: round(stridePx / cycleSeconds, 1),
      loopResidualPx: round(loopResidualPx, 2),
      sampleSpacingFrames: round(sampleSpacingFrames, 2),
      msPerFrame: round((cycleSeconds * 1000) / Math.max(1, baked - 1), 1),
      decimation: decimationError(spec, clips),
      facings: FACINGS.map((f) => facingMetrics(f, clips[f], inPlane[f])),
      // Deep pose equality, not just angle equality: a clip whose endpoints
      // agree on every angle but differ by a quarter-pixel of trunk dx still
      // twitches at the wrap, and `dx/dy` is where the out-of-plane residual
      // lives — precisely the channel a locomotion import writes most into.
      loops: FACINGS.every((f) => {
        const at0 = sampleClip(TEMPLATES[f], clips[f], 0);
        const at1 = sampleClip(TEMPLATES[f], clips[f], 1);
        return JSON.stringify(at0) === JSON.stringify(at1);
      }),
    },
  };
}

function facingMetrics(facing: RigFacing, clip: Clip, inPlane: readonly BoneInPlane[]): FacingMetrics {
  let maxDeg = 0;
  let maxStepDeg = 0;
  let maxStepChip = '';
  let loopDeg = 0;
  for (const [chip, track] of Object.entries(clip.tracks)) {
    for (const k of track) maxDeg = Math.max(maxDeg, Math.abs(k.deg));
    // Per-BAKED-FRAME step, read off the keyed curve at frame times. A gesture
    // sampled below twice its own rate shows up here as a step near or past
    // 180° — the angle unwrapper's blind spot, and the reason this is measured.
    for (let f = 1; f < clip.frames; f++) {
      const a = keyedAt(track, (f - 1) / (clip.frames - 1));
      const b = keyedAt(track, f / (clip.frames - 1));
      if (Math.abs(b - a) > maxStepDeg) {
        maxStepDeg = Math.abs(b - a);
        maxStepChip = chip;
      }
    }
    loopDeg = Math.max(loopDeg, Math.abs(keyedAt(track, 1) - keyedAt(track, 0)));
  }
  // The floor is read only over bones that actually got a track: a bone the
  // importer skipped (missing joint) or held (fully degenerate) cannot windmill.
  const rotating = inPlane.filter((b) => clip.tracks[b.chip] !== undefined);
  const floor = rotating.reduce<BoneInPlane | null>((w, b) => (w === null || b.min < w.min ? b : w), null);
  return {
    facing,
    tracks: Object.keys(clip.tracks).length,
    maxDeg: round(maxDeg, 1),
    maxStepDeg: round(maxStepDeg, 1),
    maxStepChip,
    loopDeg: round(loopDeg, 1),
    plants: clip.plant?.length ?? 0,
    minInPlane: floor?.min ?? 1,
    minInPlaneChip: floor?.chip ?? '',
  };
}

/** Linear read of a keyed track at `t` — diagnostics only, not the rig's easing. */
function keyedAt(track: readonly Keyframe[], t: number): number {
  if (track.length === 0) return 0;
  if (t <= track[0].t) return track[0].deg;
  for (let i = 1; i < track.length; i++) {
    if (t <= track[i].t) {
      const span = track[i].t - track[i - 1].t;
      const w = span > 0 ? (t - track[i - 1].t) / span : 0;
      return track[i - 1].deg + w * (track[i].deg - track[i - 1].deg);
    }
  }
  return track[track.length - 1].deg;
}

// ── serialization (the byte-stable half of the determinism contract) ─────────

/** Never emit `-0`: it round-trips through JSON fine and compares badly. */
const num = (v: number): string => (Object.is(v, -0) ? '0' : String(v));

const keyframe = (k: Keyframe): string => {
  const parts = [`t: ${num(k.t)}`, `deg: ${num(k.deg)}`];
  if (k.dx !== undefined) parts.push(`dx: ${num(k.dx)}`);
  if (k.dy !== undefined) parts.push(`dy: ${num(k.dy)}`);
  return `{ ${parts.join(', ')} }`;
};

/**
 * Fixed shape: `name`, `frames`, `tracks` in the template's chip order (which
 * is the order `projectToRig` inserts them), then `plant`, then `skinBand`. No
 * sorting, no conditionals beyond presence — the output shape must not depend
 * on chance.
 */
function serializeClip(constName: string, clip: Clip): string {
  const out: string[] = [`export const ${constName}: Clip = {`];
  out.push(`  name: '${clip.name}',`);
  out.push(`  frames: ${clip.frames},`);
  out.push('  tracks: {');
  for (const [chip, track] of Object.entries(clip.tracks)) {
    out.push(`    ${chip}: [`);
    for (const k of track) out.push(`      ${keyframe(k)},`);
    out.push('    ],');
  }
  out.push('  },');
  if (clip.plant) {
    out.push('  plant: [');
    for (const p of clip.plant) out.push(`    { chip: '${p.chip}', point: [${num(p.point[0])}, ${num(p.point[1])}] },`);
    out.push('  ],');
  }
  if (clip.skinBand !== undefined) out.push(`  skinBand: ${clip.skinBand},`);
  out.push('};');
  return out.join('\n');
}

const constBase = (id: string): string => `CLIP_${id.toUpperCase().replace(/-/g, '_')}`;
export const moduleFileFor = (spec: ImportSpec): string => join(CLIPS_DIR, `${spec.id}.ts`);

/** Wrap a sentence to `width`, prefixing every line with ` * `. */
function wrap(text: string, width = 76): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    if (line.length > 0 && line.length + 1 + w.length > width) {
      lines.push(line);
      line = w;
    } else line = line.length > 0 ? `${line} ${w}` : w;
  }
  if (line.length > 0) lines.push(line);
  return lines;
}

export function renderModule(spec: ImportSpec, clips: Record<RigFacing, Clip>, m: ClipMetrics): string {
  const o = spec.opts;
  const locomotion = m.stridePx >= 1;
  const head: string[] = [
    '/**',
    ` * GENERATED by \`npx tsx scripts/motion-import-bvh.ts ${spec.id}\` — do not`,
    ' * hand-edit; re-run to change. Byte-identity is pinned by',
    ' * `tests/unit/motion-import-determinism.test.ts`.',
    ' *',
    ` * Capture: vendor/mocap/cmu/${spec.source} — CMU Graphics Lab Motion Capture`,
    ' * Database, cgspeed BVH conversion, 120 fps (see CREDITS.md).',
    ' *',
    ...wrap(spec.note).map((l) => ` * ${l}`),
    ' *',
    ` * Options: range [${o.range[0]}, ${o.range[1]}] · frames ${o.frames} ·`,
    ` *   referenceFrame ${typeof o.referenceFrame === 'string' ? `'${o.referenceFrame}'` : o.referenceFrame} ·`,
    ` *   loop ${o.loop ? `'${o.loop}'` : "'auto'"} · rootMotion 'in-place' (default) ·`,
    ` *   pxPerUnit ${m.pxPerUnit} (${FIGURE_HEIGHT_PX} px figure ÷ T-pose extent ${m.tposeUnits} units)`,
    ' *',
    ` * Cycle: ${m.cycleFrames} source frames = ${m.cycleSeconds} s.`,
  ];
  if (locomotion) {
    head.push(
      ` * Stride: ${m.stridePx} px per cycle → IMPLIED GROUND SPEED ${m.groundSpeedPxPerSec} px/s.`,
      ' *   The bake is in-place, so the feet slide one stride per cycle and read as',
      ' *   PLANTED only when the NPC actually moves at that speed. That is M2\'s',
      ' *   tuning knob, not a defect of this bake.',
    );
  } else {
    head.push(
      ` * Stride: ${m.stridePx} px per cycle — under the 1 px floor, so this is capture`,
      ' *   noise rather than travel. Recorded as stride 0 / ground speed 0, which is',
      ' *   the honest reading: play it on an NPC standing still.',
    );
  }
  head.push(` * Loop residual (capture, first→last pose): ${m.loopResidualPx} px RMS per joint.`);
  head.push(
    ' *',
    ` * Sampling: ${m.sampleSpacingFrames} source frames between baked samples (${m.msPerFrame} ms per frame).`,
  );
  if (m.decimation) {
    head.push(
      ` *   DECIMATION ERROR vs an undecimated bake of the same range: ${m.decimation.rmsDeg}° RMS,`,
      ` *   ${m.decimation.maxDeg}° peak, worst on ${m.decimation.chip} (${m.decimation.facing}).`,
      ' *   That is the whole aliasing question answered by measurement: an under-sampled',
      ' *   wiggle reconstructs to the wrong shape and this number blows up. Re-run the',
      ' *   importer to check it rather than trusting this sentence.',
    );
  }
  head.push(' *');
  head.push(' * Per facing — tracks, worst per-frame angle step, t=0..t=1 gap, plants,');
  head.push(' * and the foreshortening floor (least of any rotating bone in-plane length):');
  for (const f of m.facings) {
    head.push(
      ` *   ${f.facing.padEnd(5)} ${String(f.tracks).padStart(2)} tracks · max ${String(f.maxDeg).padStart(6)}° ·` +
        ` step ${String(f.maxStepDeg).padStart(5)}° (${f.maxStepChip || '—'}) ·` +
        ` loop ${f.loopDeg}° · ${f.plants} plant(s) ·` +
        ` in-plane ≥ ${f.minInPlane} (${f.minInPlaneChip || '—'})`,
    );
  }
  head.push(
    ' *',
    ' * A per-frame step approaching 180° would mean the gesture outran the baked',
    ' * rate and the angle unwrapper picked the wrong branch. A foreshortening',
    " * floor approaching 0 would mean a bone points at the camera and the rig is",
    ' * rotating a chip on noise. Neither happens here — the captures that DID',
    ' * fail those two reads are listed, with their numbers, in the importer.',
    ' */',
  );

  const base = constBase(spec.id);
  // `skinBand` is a per-facing override authored on the SPEC, not derived from
  // the capture — see `ImportSpec.skinBand`'s doc comment. Applied here, right
  // before serialization, so `clips.down`/`clips.up` (what every OTHER reader
  // of this function — metrics, decimation, the facing table above — sees)
  // stay exactly what the importer produced.
  const down: Clip = spec.skinBand?.down !== undefined ? { ...clips.down, skinBand: spec.skinBand.down } : clips.down;
  const up: Clip = spec.skinBand?.up !== undefined ? { ...clips.up, skinBand: spec.skinBand.up } : clips.up;
  const body = [
    "import type { Clip } from '../rig';",
    "import type { ImportedClipMeta } from '../clip-meta';",
    '',
    // The numbers above this line are a comment; these are the same numbers as
    // something a bench or a runtime can actually read. The foot-plant speed in
    // particular is unusable as prose — see `clip-meta.ts`.
    `/** Capture facts a player can feel: cadence, travel, and whether it loops. */`,
    `export const ${base}_META: ImportedClipMeta = {`,
    `  source: '${spec.source}',`,
    `  cycleSeconds: ${m.cycleSeconds},`,
    `  frameMs: ${m.msPerFrame},`,
    `  stridePx: ${locomotion ? m.stridePx : 0},`,
    `  groundSpeedPxPerSec: ${locomotion ? m.groundSpeedPxPerSec : 0},`,
    `  loop: ${m.loops},`,
    '};',
    '',
    serializeClip(`${base}_DOWN`, down),
    '',
    serializeClip(`${base}_UP`, up),
    '',
    serializeClip(`${base}_LEFT`, clips.left),
    '',
    '/** The three AUTHORED facings; east is west mirrored at bake time (`facing.ts`). */',
    `export const ${base}: Readonly<Record<'down' | 'up' | 'left', Clip>> = {`,
    `  down: ${base}_DOWN,`,
    `  up: ${base}_UP,`,
    `  left: ${base}_LEFT,`,
    '};',
  ];
  return `${[...head, '', ...body].join('\n')}\n`;
}

export const indexFile = (): string => join(CLIPS_DIR, 'index.ts');

export function renderIndex(specs: readonly ImportSpec[]): string {
  const lines: string[] = [
    '/**',
    ' * GENERATED by `npx tsx scripts/motion-import-bvh.ts` — do not hand-edit;',
    ' * re-run to change. Byte-identity is pinned by',
    ' * `tests/unit/motion-import-determinism.test.ts`.',
    ' *',
    ' * Every clip imported from the vendored CMU captures, keyed by clip name.',
    ' * Each entry holds the three AUTHORED facings; east is west mirrored at bake',
    ' * time (`facing.ts`), so it is never imported.',
    ' *',
    ' * `IMPORTED_CLIP_META` is keyed the same way — same ids, one entry each, so a',
    ' * caller holding a clip name can always ask what capture it came from and how',
    ' * fast it wants to be played.',
    ' */',
    "import type { Clip } from '../rig';",
    "import type { ImportedClipMeta } from '../clip-meta';",
  ];
  for (const s of specs) lines.push(`import { ${constBase(s.id)}, ${constBase(s.id)}_META } from './${s.id}';`);
  lines.push('');
  for (const s of specs) lines.push(`export { ${constBase(s.id)}, ${constBase(s.id)}_META } from './${s.id}';`);
  lines.push('');
  lines.push("export type ImportedClipSet = Readonly<Record<'down' | 'up' | 'left', Clip>>;");
  lines.push('');
  lines.push('export const IMPORTED_CLIPS: Readonly<Record<string, ImportedClipSet>> = {');
  for (const s of specs) lines.push(`  '${s.id}': ${constBase(s.id)},`);
  lines.push('};');
  lines.push('');
  lines.push('export const IMPORTED_CLIP_META: Readonly<Record<string, ImportedClipMeta>> = {');
  for (const s of specs) lines.push(`  '${s.id}': ${constBase(s.id)}_META,`);
  lines.push('};');
  return `${lines.join('\n')}\n`;
}

// ── CLI ─────────────────────────────────────────────────────────────────────

/**
 * A capture the table does NOT list can still be measured: pass a `.bvh`
 * filename with `--in-plane` and a `--range`/`--frames` to reproduce the
 * numbers behind the declined block above without adding it to the table.
 */
function trialSpec(source: string): ImportSpec {
  const arg = (flag: string): string | undefined => {
    const i = process.argv.indexOf(flag);
    return i >= 0 ? process.argv[i + 1] : undefined;
  };
  const range = (arg('--range') ?? '').split(',').map(Number);
  // No silent default: a trial with no range would silently measure the
  // synthetic T-pose, which is the one frame in the file that means nothing.
  if (range.length !== 2 || !range.every(Number.isFinite) || range[1] <= range[0]) {
    console.error(`--in-plane ${source} needs an explicit --range a,b (b > a)`);
    process.exit(1);
  }
  return {
    id: source.replace(/\.bvh$/, ''),
    source,
    note: 'ad-hoc trial import — not part of the checked-in table.',
    opts: {
      range: [range[0], range[1]],
      frames: Number(arg('--frames') ?? 9),
      referenceFrame: arg('--ref') === undefined ? 'mean' : Number(arg('--ref')),
    },
  };
}

function main(): void {
  const plan = process.argv.includes('--plan');
  const flagValues = new Set(['--range', '--frames', '--ref', '--from', '--min', '--max'].flatMap((f) => {
    const i = process.argv.indexOf(f);
    return i >= 0 ? [process.argv[i + 1]] : [];
  }));
  const positional = process.argv.slice(2).filter((a) => !a.startsWith('--') && !flagValues.has(a));

  const arg = (flag: string): string | undefined => {
    const i = process.argv.indexOf(flag);
    return i >= 0 ? process.argv[i + 1] : undefined;
  };

  // ── range finding: how a `range` in the table above gets chosen ────────────
  if (process.argv.includes('--contacts')) {
    const source = positional[0];
    if (!source?.endsWith('.bvh')) {
      console.error('--contacts needs a vendor/mocap/cmu/*.bvh filename');
      process.exit(1);
    }
    const runs = stanceRuns(source);
    console.log(`${source}: stance runs (importer's own rule: ankle near ground, moving slowly)`);
    for (const r of runs) console.log(`  ${r.joint.padEnd(10)} ${String(r.from).padStart(5)} – ${String(r.to).padStart(5)}`);
    console.log('  One gait cycle = the gap between successive onsets of the SAME foot:');
    for (const joint of [...new Set(runs.map((r) => r.joint))]) {
      const onsets = runs.filter((r) => r.joint === joint).map((r) => r.from);
      console.log(`  ${joint.padEnd(10)} onsets ${onsets.join(', ')} → gaps ${onsets.slice(1).map((v, i) => v - onsets[i]).join(', ')}`);
    }
    return;
  }

  if (process.argv.includes('--periods')) {
    const source = positional[0];
    const from = Number(arg('--from'));
    if (!source?.endsWith('.bvh') || !Number.isFinite(from)) {
      console.error('--periods needs a vendor/mocap/cmu/*.bvh filename and --from <frame> [--min n --max n]');
      process.exit(1);
    }
    const min = Number(arg('--min') ?? 30);
    const max = Number(arg('--max') ?? 300);
    console.log(`${source}: cycle candidates from frame ${from}, ranked by how nearly the pose returns`);
    for (const c of periodCandidates(source, from, min, max).slice(0, 10)) {
      console.log(
        `  P=${String(c.frames).padStart(4)} (${c.seconds.toFixed(3)}s)  pose distance ${c.poseDistancePx.toFixed(3)} px  travel ${c.travelPx} px`,
      );
    }
    return;
  }

  if (process.argv.includes('--sweep')) {
    const base = positional[0]?.endsWith('.bvh') ? trialSpec(positional[0]) : MOTION_IMPORTS.find((s) => s.id === positional[0]);
    if (!base) {
      console.error('--sweep needs a clip id or a *.bvh filename with --range a,b');
      process.exit(1);
    }
    console.log(`${base.id} range [${base.opts.range[0]}, ${base.opts.range[1]}] — decimation error vs frame count:`);
    for (const frames of [5, 9, 13, 17, 21, 25, 33, 41, 49, 65]) {
      if (frames > base.opts.range[1] - base.opts.range[0] + 1) break;
      const spec = { ...base, opts: { ...base.opts, frames } };
      const { metrics } = runImport(spec);
      console.log(
        `  frames ${String(frames).padStart(3)} · spacing ${String(metrics.sampleSpacingFrames).padStart(6)} · ${String(metrics.msPerFrame).padStart(6)} ms/frame · ` +
          `error ${String(metrics.decimation?.rmsDeg ?? 0).padStart(6)}° RMS / ${String(metrics.decimation?.maxDeg ?? 0).padStart(6)}° peak (${metrics.decimation?.chip ?? '—'})`,
      );
    }
    return;
  }

  if (process.argv.includes('--in-plane')) {
    const spec = positional[0]?.endsWith('.bvh')
      ? trialSpec(positional[0])
      : MOTION_IMPORTS.find((s) => s.id === positional[0]);
    if (!spec) {
      console.error('--in-plane needs a clip id or a vendor/mocap/cmu/*.bvh filename (with --range a,b --frames n)');
      process.exit(1);
    }
    console.log(`${spec.id} ← ${spec.source} range [${spec.opts.range[0]}, ${spec.opts.range[1]}] · ${spec.opts.frames} frames`);
    const table = inPlaneFractions(spec);
    for (const facing of FACINGS) {
      console.log(`  ${facing}:`);
      for (const b of table[facing]) {
        console.log(`    ${b.chip.padEnd(14)} min ${b.min.toFixed(2)} mean ${b.mean.toFixed(2)}  [${b.frames.map((v) => v.toFixed(2)).join(' ')}]`);
      }
    }
    return;
  }

  const wanted = positional;
  const specs = wanted.length > 0 ? MOTION_IMPORTS.filter((s) => wanted.includes(s.id)) : MOTION_IMPORTS;
  const unknown = wanted.filter((w) => !MOTION_IMPORTS.some((s) => s.id === w));
  if (unknown.length > 0) {
    console.error(`unknown clip id(s): ${unknown.join(', ')}`);
    console.error(`known: ${MOTION_IMPORTS.map((s) => s.id).join(', ')}`);
    process.exit(1);
  }
  if (specs.length === 0) {
    console.error('nothing to import');
    process.exit(1);
  }

  if (!plan) mkdirSync(CLIPS_DIR, { recursive: true });
  for (const spec of specs) {
    const { clips, metrics } = runImport(spec);
    const text = renderModule(spec, clips, metrics);
    const file = moduleFileFor(spec);
    console.log(`${spec.id}  ← ${spec.source}  range [${spec.opts.range[0]}, ${spec.opts.range[1]}] · ${spec.opts.frames} frames`);
    console.log(
      `  cycle ${metrics.cycleSeconds}s · stride ${metrics.stridePx}px · ground speed ${metrics.groundSpeedPxPerSec}px/s ·` +
        ` loop residual ${metrics.loopResidualPx}px`,
    );
    console.log(
      `  spacing ${metrics.sampleSpacingFrames} frames (${metrics.msPerFrame}ms/frame) · decimation error ${
        metrics.decimation ? `${metrics.decimation.rmsDeg}° RMS / ${metrics.decimation.maxDeg}° peak on ${metrics.decimation.chip} (${metrics.decimation.facing})` : 'n/a'
      }`,
    );
    for (const f of metrics.facings) {
      console.log(
        `  ${f.facing.padEnd(5)} ${String(f.tracks).padStart(2)} tracks · max ${String(f.maxDeg).padStart(6)}° ·` +
          ` worst step ${String(f.maxStepDeg).padStart(5)}° (${f.maxStepChip || '—'}) · loop gap ${f.loopDeg}° ·` +
          ` ${f.plants} plant(s) · in-plane ≥ ${f.minInPlane} (${f.minInPlaneChip || '—'})`,
      );
    }
    if (plan) console.log(`  WOULD WRITE ${file} (${text.split('\n').length} lines)`);
    else {
      writeFileSync(file, text);
      console.log(`  wrote ${file}`);
    }
  }

  // The index always lists the FULL table, never just the filtered run — a
  // partial re-run must not silently drop clips from the registry.
  const index = renderIndex(MOTION_IMPORTS);
  if (plan) console.log(`WOULD WRITE ${indexFile()} (${index.split('\n').length} lines)`);
  else {
    writeFileSync(indexFile(), index);
    console.log(`wrote ${indexFile()}`);
  }
  if (plan) console.log('\n--plan: nothing was written.');
}

// Only run as a CLI. The determinism test imports this module for its table and
// its emit functions, and must not have a file-writing side effect.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
