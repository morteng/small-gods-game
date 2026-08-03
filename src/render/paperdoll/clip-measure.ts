/**
 * Instrumentation for the motion bench — how close a baked clip is to a
 * reference row, and how much its planted foot actually slides.
 *
 * These are NUMBERS, not gates. The imported clips are projections of a CMU
 * capture; the LPC rows they get held against are a different artist's cycle,
 * so a perfect score is neither achievable nor wanted. What the numbers buy is
 * a way to say "that got worse" out loud instead of squinting.
 *
 * Pure and DOM-free on purpose (same contract as `rig.ts`): the motion studio
 * calls these and draws, `tests/unit/paperdoll-clip-measure.test.ts` calls them
 * and asserts. Nothing on the game's render path imports this module — dev
 * visualisation stays in the studios.
 */
import { alphaIoU, type Raster } from '../sprite-postprocess';
import { applyAffine, chipWorldTransforms, sampleClip, type AnimTemplate, type Clip } from './rig';

/** Alpha at or above which a pixel counts as silhouette — `sprite-postprocess`'s own cut. */
const ALPHA_MIN = 8;

export interface FrameCompare {
  /** Silhouette intersection-over-union, 0..1. */
  iou: number;
  /**
   * Mean RGB distance over the pixels BOTH rasters cover, 0..441. Scoped to the
   * intersection because outside it one side has no colour at all, and scoring
   * a missing pixel as "very different" would just re-measure the IoU.
   */
  colorDelta: number;
  /** Pixels in the intersection — `colorDelta` is meaningless when this is 0. */
  overlapPx: number;
}

/**
 * Compare two same-sized frames on silhouette and colour.
 *
 * The IoU half delegates to `alphaIoU` rather than re-deriving it: that is the
 * vocabulary the building-art gates already speak, and a second implementation
 * is a second thing to drift.
 */
export function frameCompare(a: Raster, b: Raster, alphaMin = ALPHA_MIN): FrameCompare {
  if (a.w !== b.w || a.h !== b.h) throw new Error('frameCompare: dimension mismatch');
  let sum = 0;
  let overlapPx = 0;
  for (let i = 0; i < a.w * a.h; i++) {
    if (a.data[i * 4 + 3] < alphaMin || b.data[i * 4 + 3] < alphaMin) continue;
    const dr = a.data[i * 4] - b.data[i * 4];
    const dg = a.data[i * 4 + 1] - b.data[i * 4 + 1];
    const db = a.data[i * 4 + 2] - b.data[i * 4 + 2];
    sum += Math.sqrt(dr * dr + dg * dg + db * db);
    overlapPx++;
  }
  return {
    iou: alphaIoU(a, b, alphaMin),
    colorDelta: overlapPx === 0 ? 0 : sum / overlapPx,
    overlapPx,
  };
}

/**
 * Distinct poses in one cycle of a baked strip.
 *
 * `bakeClip` samples frame i at t = i/(frames−1), so a LOOPING clip's last
 * frame is its first over again. Counting it twice is what makes an 8-frame
 * LPC row and a 9-frame imported walk look like different-length cycles when
 * they are in fact the same eight poses.
 */
export function cycleLength(frames: number, loops: boolean): number {
  return loops && frames > 1 ? frames - 1 : Math.max(1, frames);
}

/**
 * Frame index of a cycle of `count` equal slices at phase `t`.
 *
 * Phase, never index: the reference row and the bake are locked to the same
 * t ∈ [0,1) and each picks its own frame from it, so an 8-frame row and a
 * 9-frame bake compare like-for-like poses instead of drifting apart by one.
 * `t` wraps, so t=1 lands back on frame 0.
 */
export function cycleFrameAtPhase(count: number, t: number): number {
  if (count <= 1) return 0;
  const i = Math.floor(t * count) % count;
  return i < 0 ? i + count : i;
}

/**
 * Where a rest-space point on `chip` ends up in cell space, per baked frame.
 * The sole of a boot is the interesting one: its trajectory IS the foot-skate
 * question, and it is only readable through the FK (the imported locomotion
 * clips bake `rootMotion: 'in-place'` and carry no `plant` entries at all).
 */
export function chipPointTrack(
  template: AnimTemplate,
  clip: Clip,
  chip: string,
  point: readonly [number, number],
): [number, number][] {
  const ci = template.chips.findIndex((c) => c.name === chip);
  if (ci < 0) return [];
  const denom = Math.max(1, clip.frames - 1);
  const out: [number, number][] = [];
  for (let f = 0; f < clip.frames; f++) {
    const world = chipWorldTransforms(template, sampleClip(template, clip, f / denom));
    out.push(applyAffine(world[ci], point[0], point[1]));
  }
  return out;
}

/**
 * Peak-to-peak keyed rotation of one chip's track, in degrees; 0 if unkeyed.
 *
 * The number that says a frontal walk barely swings its legs — a capture walked
 * TOWARD the camera puts almost all of its leg travel out of plane, so the
 * sagittal facing keys tens of degrees where the frontal ones key single
 * digits. That is the projection being honest about what a fixed chip can
 * express, not a defect, and the bench should say it out loud rather than let
 * someone read the frontal bake as a broken import.
 */
export function trackRangeDeg(clip: Clip, chip: string): number {
  const track = clip.tracks[chip];
  if (!track || track.length === 0) return 0;
  const degs = track.map((k) => k.deg);
  return Math.max(...degs) - Math.min(...degs);
}

export interface SkateReport {
  /** Per-frame residual distance from the detrended mean, in cell px. */
  perFrame: readonly number[];
  /** Largest `perFrame` value — the frame a viewer would catch. */
  worst: number;
  /** Which frame that was. */
  worstFrame: number;
  /** Widest gap between any two DETRENDED positions — the jitter, in cell px. */
  jitter: number;
  /** Widest gap between any two RAW positions — jitter plus the designed slide. */
  rawSpread: number;
  /** The constant slide removed, cell px per frame (signed, x then y). */
  slidePerFrame: readonly [number, number];
}

const dist = (a: readonly [number, number], b: readonly [number, number]): number =>
  Math.hypot(a[0] - b[0], a[1] - b[1]);

const widestGap = (pts: readonly (readonly [number, number])[]): number => {
  let m = 0;
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) m = Math.max(m, dist(pts[i], pts[j]));
  }
  return m;
};

/**
 * Foot skate with the DESIGNED slide taken out.
 *
 * An in-place locomotion bake slides its stance sole one stride per cycle on
 * purpose — that slide reads as planted exactly when the NPC travels at the
 * clip's own ground speed, so scoring it as error would condemn a correct bake.
 * The residual after removing a constant per-frame slide is the part no
 * playback rate can ever fix: the shiver. `rawSpread` is kept beside it so the
 * two are never confused for each other.
 *
 * The slide is estimated first-to-last rather than by least squares, matching
 * the measure `tests/unit/bvh-import.test.ts` already pins the importer with.
 */
export function skate(points: readonly (readonly [number, number])[]): SkateReport {
  const n = points.length;
  if (n === 0) {
    return { perFrame: [], worst: 0, worstFrame: 0, jitter: 0, rawSpread: 0, slidePerFrame: [0, 0] };
  }
  const denom = Math.max(1, n - 1);
  const slide: [number, number] = [
    (points[n - 1][0] - points[0][0]) / denom,
    (points[n - 1][1] - points[0][1]) / denom,
  ];
  const flat: [number, number][] = points.map((p, f) => [p[0] - slide[0] * f, p[1] - slide[1] * f]);
  const mean: [number, number] = [
    flat.reduce((s, p) => s + p[0], 0) / n,
    flat.reduce((s, p) => s + p[1], 0) / n,
  ];
  const perFrame = flat.map((p) => dist(p, mean));
  let worstFrame = 0;
  perFrame.forEach((v, i) => {
    if (v > perFrame[worstFrame]) worstFrame = i;
  });
  return {
    perFrame,
    worst: perFrame[worstFrame],
    worstFrame,
    jitter: widestGap(flat),
    rawSpread: widestGap(points),
    slidePerFrame: slide,
  };
}
