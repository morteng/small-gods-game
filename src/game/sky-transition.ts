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
