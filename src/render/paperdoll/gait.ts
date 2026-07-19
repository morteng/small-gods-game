/**
 * Gait styles — Tier-0 walk characterization: a retiming curve + a per-frame
 * whole-sprite offset envelope over the EXISTING walk cycle. No new pixels,
 * no chip slicing — identity lives in rhythm and carriage, so a limp is
 * "dwell on the good leg, rush the bad one, dip while it bears weight", not
 * a new set of drawings.
 *
 * Pure and deterministic (node + browser): the studio's gait lane simulates
 * playback through `planGait`/`gaitFrameAt`, and a runtime integration would
 * drive the same plan where `npc-animator.ts` currently ticks a fixed
 * `FRAME_MS` metronome. All arrays index by `frame % length`, so a style
 * authored for the 8-frame LPC walk also cycles over other frame counts.
 */

export interface GaitStyle {
  name: string;
  /** Whole-cycle tempo multiplier (>1 = slower stride). */
  tempo?: number;
  /**
   * Per-frame duration weights (1 = base cadence), indexed `frame % length`.
   * Asymmetry here IS the limp; strict uniformity IS the march.
   */
  timing?: readonly number[];
  /** Per-frame whole-sprite pixel offsets [dx, dy], indexed `frame % length`. */
  offsets?: readonly (readonly [number, number])[];
}

export interface GaitFrame {
  durMs: number;
  dx: number;
  dy: number;
}

export interface GaitPlan {
  frames: readonly GaitFrame[];
  /** Sum of all frame durations — one full stride cycle. */
  cycleMs: number;
}

/** Expand a style over a concrete frame count + base cadence. */
export function planGait(style: GaitStyle, frameCount: number, baseMs: number): GaitPlan {
  if (frameCount < 1) throw new Error(`planGait: frameCount ${frameCount} < 1`);
  if (baseMs <= 0) throw new Error(`planGait: baseMs ${baseMs} <= 0`);
  const tempo = style.tempo ?? 1;
  const frames: GaitFrame[] = [];
  let cycleMs = 0;
  for (let i = 0; i < frameCount; i++) {
    const weight = style.timing ? style.timing[i % style.timing.length] : 1;
    const durMs = baseMs * tempo * weight;
    if (!(durMs > 0)) throw new Error(`planGait(${style.name}): frame ${i} duration ${durMs} <= 0`);
    const off = style.offsets ? style.offsets[i % style.offsets.length] : ([0, 0] as const);
    frames.push({ durMs, dx: off[0], dy: off[1] });
    cycleMs += durMs;
  }
  return { frames, cycleMs };
}

/** Resolve the frame + offset shown at absolute time `tMs` (cycle wraps, negatives too). */
export function gaitFrameAt(plan: GaitPlan, tMs: number): GaitFrame & { frame: number } {
  const t = ((tMs % plan.cycleMs) + plan.cycleMs) % plan.cycleMs;
  let acc = 0;
  for (let i = 0; i < plan.frames.length; i++) {
    acc += plan.frames[i].durMs;
    if (t < acc) return { frame: i, ...plan.frames[i] };
  }
  const last = plan.frames.length - 1;
  return { frame: last, ...plan.frames[last] };
}

// ── presets ───────────────────────────────────────────────────────────────────
// Authored against the LPC 8-frame walk cycle: frames 0–3 are one leg's stride,
// 4–7 the other's. Offsets are cell pixels (64px space), y-down.

export const GAIT_NORMAL: GaitStyle = { name: 'normal' };

/** Old man's limp: slow; dwell on the good leg, rush the bad one, dip under it. */
export const GAIT_LIMP: GaitStyle = {
  name: 'limp',
  tempo: 1.3,
  timing: [1.5, 1.4, 1.4, 1.5, 0.55, 0.5, 0.5, 0.6],
  offsets: [
    [0, 0],
    [0, 0],
    [0, 0],
    [0, 1],
    [0, 2],
    [0, 2],
    [0, 1],
    [0, 0],
  ],
};

/** Soldier's march: brisk, rigidly even, crisp vertical bob on every step. */
export const GAIT_MARCH: GaitStyle = {
  name: 'march',
  tempo: 0.85,
  offsets: [
    [0, 0],
    [0, -1],
    [0, -2],
    [0, -1],
    [0, 0],
    [0, -1],
    [0, -2],
    [0, -1],
  ],
};

/** Unhurried sway: slow lateral hip sine with a lilt at each extreme. */
export const GAIT_SWAY: GaitStyle = {
  name: 'sway',
  tempo: 1.4,
  timing: [1, 1.15, 1, 0.9, 1, 1.15, 1, 0.9],
  offsets: [
    [0, 0],
    [1, 0],
    [2, -1],
    [1, 0],
    [0, 0],
    [-1, 0],
    [-2, -1],
    [-1, 0],
  ],
};

/** Every authored gait, in menu order (`normal` first = identity baseline). */
export const GAIT_STYLES: readonly GaitStyle[] = [GAIT_NORMAL, GAIT_LIMP, GAIT_MARCH, GAIT_SWAY];
