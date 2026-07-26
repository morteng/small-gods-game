// src/game/sky-transition.ts
//
// Pure curve helpers for the sky/cloud loading<->world TRANSITION spike (UI v3):
// the descent (loading -> world, clouds part + camera eases in) and the ascent
// (world -> title, clouds billow to cover before the state reset runs behind
// them). `shell-state.ts` owns the phase CLOCK (a linear 0..1 elapsed/duration,
// kept a trivially-testable pure reducer with no easing baked in — see its
// `TransitionState`/`transitionPhase`); this module turns that linear phase
// into the two things `Game` actually applies each frame — the sky-backdrop
// overlay's `coverage` uniform (the spare `uParams.w` slot, sky-backdrop-wgsl.ts)
// and the descent's temporary camera-Y nudge — plus the pure decision of WHEN
// the ascent's real state reset is due. All pure: no DOM, no GPU, no `Game`.
//
// Phase C slice H4 adds a THIRD user of the same curve: the Hall of the Gods'
// coverage ramp (`stepHallOverlay`), which closes the sky while that screen is
// up. It is deliberately NOT a transition — see its own doc.

import type { TransitionKind } from '@/render/ui/shell/shell-state';

/** The camera's iso-screen Y offset (world/camera px) subtracted from the
 *  settled framing at the START of a descent — "a few hundred px high" per the
 *  brief — eased to 0 by the time the clouds finish parting. Ascent has no
 *  camera motion (only the cloud billows). */
export const DESCENT_CAMERA_OFFSET_PX = 320;

/** Cubic ease-out: fast start, gentle settle — never a linear wipe. Shared by
 *  the cloud-coverage sweep and the camera ease so they land together. */
export function easeOutCubic(linear01: number): number {
  const c = Math.max(0, Math.min(1, linear01));
  return 1 - Math.pow(1 - c, 3);
}

/**
 * The sky-backdrop shader's `coverage` uniform (0 = fully revealed, 1 = full
 * cloud cover) for a transition `kind` at linear phase `linear01` (0..1, from
 * `transitionPhase`). Descent sweeps 1 -> 0 (parting, so the world is hidden
 * at phase 0 and fully shown by phase 1); ascent sweeps 0 -> 1 (billowing to
 * cover, so the world is fully shown at phase 0 and hidden by phase 1).
 */
export function coverageFor(kind: TransitionKind, linear01: number): number {
  const eased = easeOutCubic(linear01);
  return kind === 'descent' ? 1 - eased : eased;
}

/**
 * The descent's temporary camera-Y offset (world/camera px) at linear phase
 * `linear01` — `DESCENT_CAMERA_OFFSET_PX` at phase 0, eased to 0 by phase 1.
 * Callers apply this as a RENDER-time-only nudge (subtract before drawing,
 * restore immediately after — see `Game.onRender`) rather than a persistent
 * mutation, so it never fights the follow/fly camera's own easing.
 */
export function descentCameraOffsetPx(linear01: number): number {
  return DESCENT_CAMERA_OFFSET_PX * (1 - easeOutCubic(linear01));
}

/** How long the HALL's cloud ramp takes to close (or re-open) the sky, ms.
 *  Shorter than either real transition (`DESCENT_TRANSITION_MS` /
 *  `ASCENT_TRANSITION_MS`): opening a screen must feel like a screen opening,
 *  not like a level load. */
export const HALL_RAMP_MS = 700;

/** One frame of input for `stepHallOverlay`. */
export interface HallRampInput {
  /** The coverage a REAL descent/ascent wants this frame (`coverageFor`), or
   *  null when no transition is running. */
  transitionCoverage: number | null;
  /** Whether the hall owns the frame this instant (`shell.top() === 'hall'`). */
  hallOpen: boolean;
  /** The ramp's LINEAR position carried from the previous frame (0 = clear
   *  sky, 1 = fully closed). Not eased — easing is applied on read. */
  linear01: number;
  /** Wall-clock ms since the previous step (0 on the first one). */
  deltaMs: number;
}

/** One frame of output from `stepHallOverlay`. */
export interface HallRampStep {
  /** The ramp's next linear position — the caller stores this back. */
  linear01: number;
  /** What to hand the sky-backdrop overlay this frame, or null for "no overlay
   *  at all" (clear sky and no transition — the pass is skipped entirely). */
  coverage: number | null;
  /** The ramp has not reached its target yet, so the frame loop must keep
   *  drawing (`Game.onFrame`'s animating chain ORs this in). */
  animating: boolean;
}

function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
}

/**
 * The HALL OF THE GODS sits above the clouds (Phase C, slice H4): while the
 * hall is the top screen the sky-backdrop overlay closes to FULL cover, so the
 * running world beneath it is genuinely occluded rather than dimly showing
 * through, and it re-opens once the hall pops. Deliberately NOT a
 * `TransitionKind`: `beginTransition` clears the screen stack, so a transition
 * cannot carry a screen (see `shell-state.ts`). This is a Game-side ramp over
 * the same `easeOutCubic` curve, and the shell stack is untouched.
 *
 * Precedence: a real descent/ascent OWNS the sky — `transitionCoverage` is
 * honoured and the hall may only ADD cloud on top of it (`max`), never thin
 * it. That one-way rule is what keeps quit-to-title-from-the-hall from
 * flashing the world: `beginAscent` clears the stack, so the hall stops
 * drawing and its ramp starts falling, while the ascent's own sweep is still
 * near 0 — taking the ascent's number outright would briefly reveal the world
 * the player had just left. Because the ramp only ever falls in that state, it
 * cannot pin coverage open: within `HALL_RAMP_MS` the transition is the sole
 * author again.
 *
 * Pure: no Shell, no Game, no clock — every input is an argument.
 */
export function stepHallOverlay(input: HallRampInput): HallRampStep {
  const deltaMs = Number.isFinite(input.deltaMs) ? Math.max(0, input.deltaMs) : 0;
  const from = clamp01(input.linear01);
  const target = input.hallOpen ? 1 : 0;
  const step = deltaMs / HALL_RAMP_MS;
  const moved = target === 1 ? Math.min(1, from + step) : Math.max(0, from - step);
  // SNAP the last hair. Summing per-frame deltas leaves float dust (a ramp that
  // "finished" sitting at 2e-16), and both endpoints are load-bearing: 1 must be
  // a genuine full cover, and 0 must be exactly 0 or the overlay pass keeps
  // running for an invisible cloud and `animating` never goes quiet.
  const linear01 = Math.abs(moved - target) < 1e-6 ? target : moved;
  // easeOutCubic(1) is exactly 1 and easeOutCubic(0) exactly 0, so a settled
  // ramp is honestly full cover (the world never peeks through an open hall)
  // and a settled-closed one leaves no residual haze.
  const ramp = easeOutCubic(linear01);
  const coverage = input.transitionCoverage === null
    ? (linear01 > 0 ? ramp : null)
    : Math.max(input.transitionCoverage, ramp);
  return { linear01, coverage, animating: linear01 !== target };
}

/**
 * Pure decision: is the ascent's real state reset (`Game.returnToTitle`) due
 * THIS frame? True exactly once — when an ascent has reached phase 1 and
 * hasn't already fired. Kept pure (no `Game`, no clock read) so the sequencing
 * rule "ascent completing implies the reset ran, and skip still forces it" is
 * testable without booting a world: `phase` already reflects a skip (skipping
 * rewinds `startedAtMs` so `transitionPhase` reads 1 immediately), so a skip
 * makes this true on the very next call exactly like natural completion does.
 */
export function ascentResetDue(
  kind: TransitionKind | null, phase: number | null, alreadyFired: boolean,
): boolean {
  return kind === 'ascent' && (phase ?? 0) >= 1 && !alreadyFired;
}
