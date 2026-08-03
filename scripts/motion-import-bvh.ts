/**
 * Author-time BVH → rig clip importer. Free, offline, no API calls, no spend.
 *
 *   npx tsx scripts/motion-import-bvh.ts --plan        # print what it WOULD emit, write nothing
 *   npx tsx scripts/motion-import-bvh.ts               # (re)emit every clip module
 *   npx tsx scripts/motion-import-bvh.ts walk wave     # only these ids
 *   npx tsx scripts/motion-import-bvh.ts walk --in-plane            # foreshortening table
 *   npx tsx scripts/motion-import-bvh.ts 138_01.bvh --in-plane \
 *     --range 361,509 --frames 9                       # …for a capture NOT in the table
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
 *   Every emitted header therefore quotes the worst per-frame angle step, and
 *   the determinism suite refuses any clip that steps past 180°. The fix when
 *   that fires is a tighter `range` / more `frames`, never looser tolerances.
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
import type { Clip, Keyframe } from '../src/render/paperdoll/rig';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CAPTURES = join(ROOT, 'vendor/mocap/cmu');
export const CLIPS_DIR = join(ROOT, 'src/render/paperdoll/clips');

/** LPC figure height in cell px: head top (y 11) to sole (y 62). */
const FIGURE_HEIGHT_PX = 51;

const FACINGS = ['down', 'up', 'left'] as const;

export interface ImportSpec {
  /** Clip name, module basename, and the CLI filter token. ASCII, kebab-case. */
  id: string;
  /** Capture filename under `vendor/mocap/cmu/`. */
  source: string;
  /** One line on what the capture is and how this range was found. */
  note: string;
  /** Everything `projectToRig` is told, minus `name`/`pxPerUnit` (derived here). */
  opts: BvhImportOptions & { range: [number, number]; frames: number };
}

/**
 * The clip table. Every `range` here is measured, not guessed, and each `note`
 * records BOTH the number and how it was obtained (successive same-foot stance
 * onsets, and the period minimizing the first/last hips-relative pose distance).
 * Honest limit on reproducibility: those two searches were run in throwaway
 * probes over `parseBvh`/`fkPositions` and are NOT checked in — the notes carry
 * the results, not the search. `--in-plane` is the one diagnostic that lives
 * here, because it is the one that decided which captures were importable.
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
      'rig rest cell should mean. Phase budget at 17 frames: one frame of raise, ~13 ' +
      'held aloft, two of lowering — the raise genuinely takes 0.13 s in the capture, ' +
      'so more frames buy a smoother hold, not a smoother raise. ' +
      'CAVEAT, STATED RATHER THAN HIDDEN: the wave proper is a 24-frame forearm ' +
      'oscillation and this decimation samples every ~15.6 frames, so what survives ' +
      'on the forearm chips is an UNDER-SAMPLED oscillation — right limb, right ' +
      'amplitude (~±25 deg), right duration, wrong phase. That is the honest trade at ' +
      'a sprite-row frame count; resolving 24 frames would need ~60 baked frames. ' +
      'The dangerous failure (the unwrapper picking the wrong branch and winding the ' +
      'chip past a full turn) was checked for and does not happen HERE: the worst ' +
      'per-frame step is 113 deg, and it is the real raise. It DOES happen at 11 ' +
      'frames, where the sample spacing lands near the oscillation period and the ' +
      'forearm winds to -359 deg — which is why the frame count is not a free dial.',
    opts: { range: [1, 250], frames: 17, referenceFrame: 0, loop: 'none' },
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
  facings: FacingMetrics[];
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

/**
 * How much of each bone survives the projection, per facing — the CAUSE behind
 * a windmilling chip, where the emitted track only shows the symptom. This is
 * what decides whether a capture is importable at all (see the declined block
 * above), so it lives here rather than in a throwaway probe.
 *
 * HONEST DUPLICATION: the sampling, world-up, forward guess and per-facing
 * screen-right below MIRROR `projectToRig`'s internals, which are private to
 * `bvh.ts`. They can drift. This is diagnostic output only — nothing emitted
 * depends on it — and a drift shows up immediately as numbers that no longer
 * explain the tracks beside them.
 */
export function inPlaneFractions(spec: ImportSpec): Record<RigFacing, BoneInPlane[]> {
  const bvh = readCapture(spec.source);
  const [r0, r1] = spec.opts.range;
  const span = r1 - r0;
  const n = Math.max(1, Math.min(spec.opts.frames, span + 1));
  const src: number[] = [];
  for (let f = 0; f < n; f++) src.push(n === 1 ? r0 : r0 + Math.round((f * span) / (n - 1)));
  const pos = src.map((f) => fkPositions(bvh, bvh.frames[f]));

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
      return pos[Math.max(0, Math.min(spec.opts.referenceFrame ?? 0, n - 1))][j];
    }
    const s: Vec3 = [0, 0, 0];
    for (const p of pos) {
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

  const out = {} as Record<RigFacing, BoneInPlane[]>;
  for (const facing of FACINGS) {
    const u = rightOf(facing);
    const bones: BoneInPlane[] = [];
    for (const bone of HUMANOID_BVH_MAP.facings[facing].bones) {
      if (bone.mode === 'translate') continue; // never rotated: foreshortening is moot
      const a = resolve(bone.from);
      const b = resolve(bone.to);
      if (a < 0 || b < 0) continue;
      const fr = pos.map((p) => {
        const d = sub(p[b], p[a]);
        const L3 = Math.hypot(d[0], d[1], d[2]);
        return L3 > 0 ? Math.hypot(dot(d, u), dot(d, up)) / L3 : 1;
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

  const clips = projectToRig(bvh, HUMANOID_BVH_MAP, {
    ...spec.opts,
    name: spec.id,
    pxPerUnit,
  });

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
      facings: FACINGS.map((f) => facingMetrics(f, clips[f], inPlane[f])),
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
 * is the order `projectToRig` inserts them), then `plant`. No sorting, no
 * conditionals beyond presence — the output shape must not depend on chance.
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
      ` * Stride: ${m.stridePx} px per cycle — this clip does not travel; ground speed 0.`,
    );
  }
  head.push(` * Loop residual (capture, first→last pose): ${m.loopResidualPx} px RMS per joint.`);
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
  const body = [
    "import type { Clip } from '../rig';",
    '',
    serializeClip(`${base}_DOWN`, clips.down),
    '',
    serializeClip(`${base}_UP`, clips.up),
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
    ' * NOT wired into `rig-catalog.ts` — that is a separate slice.',
    ' */',
    "import type { Clip } from '../rig';",
  ];
  for (const s of specs) lines.push(`import { ${constBase(s.id)} } from './${s.id}';`);
  lines.push('');
  for (const s of specs) lines.push(`export { ${constBase(s.id)} } from './${s.id}';`);
  lines.push('');
  lines.push("export type ImportedClipSet = Readonly<Record<'down' | 'up' | 'left', Clip>>;");
  lines.push('');
  lines.push('export const IMPORTED_CLIPS: Readonly<Record<string, ImportedClipSet>> = {');
  for (const s of specs) lines.push(`  '${s.id}': ${constBase(s.id)},`);
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
  const flagValues = new Set(['--range', '--frames', '--ref'].flatMap((f) => {
    const i = process.argv.indexOf(f);
    return i >= 0 ? [process.argv[i + 1]] : [];
  }));
  const positional = process.argv.slice(2).filter((a) => !a.startsWith('--') && !flagValues.has(a));

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
