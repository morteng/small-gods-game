// src/render/ui/shell/shell-state.ts
//
// The SHELL screen stack — the game's meta-UI state machine (UI v3, §3.3).
//
// Everything outside the running world (title, loading, save/load, settings,
// pause, game-over, photo mode) is a SCREEN, and the screens form a stack:
// pushing goes deeper (title → load), popping comes back out, and an EMPTY
// stack means "no screen — the in-game HUD owns the frame".
//
// This module is a pure reducer: immutable state in, immutable state out, no
// I/O, no DOM, no WebGPU, no clock. That is deliberate — the stack is the piece
// every other shell surface keys off, so it has to be trivially testable and
// impossible to get into a half-mutated state. The screens themselves are pure
// draw functions (see `loading-screen.ts` and its siblings); the mutable glue
// lives in `shell.ts`.

/** Every meta screen the shell can show. `loading` is the WebGPU heir to the old
 *  DOM loading overlay; the rest arrive with their phases (see the epic spec). */
export type ScreenId =
  | 'title'
  | 'newgame'
  | 'load'
  | 'save'
  | 'settings'
  | 'controls'
  | 'loading'
  | 'pause'
  | 'gameover'
  | 'photo';

/** A sky/cloud TRANSITION (UI v3 spike): the loading→world DESCENT (clouds
 *  part, camera eases in — starts only once the art-settle gate clears) or
 *  the world→title ASCENT (clouds billow to cover, then `Game` performs the
 *  actual state reset behind them). Lives ALONGSIDE the screen stack, not
 *  folded into a `ScreenId`, because — unlike every stack screen — a
 *  transition is an OVERLAY: the world (HUD included) keeps drawing
 *  underneath it, whereas a stack screen wins over everything (see
 *  `UiRuntime.frame`'s doc). `startedAtMs`/`durationMs` are the phase CLOCK;
 *  `transitionPhase` below turns them into the 0..1 progress `Game` actually
 *  drives the camera/cloud-coverage curves from (`src/game/sky-transition.ts`
 *  owns those curves — this module only owns "how far through are we"). */
export type TransitionKind = 'descent' | 'ascent';

export interface TransitionState {
  readonly kind: TransitionKind;
  readonly startedAtMs: number;
  readonly durationMs: number;
}

/** ~2.8s: clouds part + the camera eases in once the art-settle gate clears
 *  (`Shell.hide()`, boot-sequence.ts's `holdLoadingUntilArtSettled`). */
export const DESCENT_TRANSITION_MS = 2800;
/** ~1.5s: clouds billow to full cover BEFORE the state reset runs behind them
 *  (masks the teardown hitch) — see `Shell.beginAscent()`. */
export const ASCENT_TRANSITION_MS = 1500;

/** The shell's whole state. `stack` is ordered outermost-first, so the LAST
 *  entry is what the player is looking at. Empty ⇒ the in-game HUD (or, while
 *  `transition` is set, the world/HUD showing through the cloud overlay). */
export interface ShellState {
  readonly stack: readonly ScreenId[];
  readonly transition: TransitionState | null;
}

/** No screen, no transition — the in-game HUD owns the frame outright. */
export const EMPTY_SHELL: ShellState = { stack: [], transition: null };

/** The screen the player is looking at, or null when the HUD owns the frame. */
export function topOf(s: ShellState): ScreenId | null {
  return s.stack.length ? s.stack[s.stack.length - 1] : null;
}

/** How deep the stack is (0 ⇒ in-game HUD). */
export function depth(s: ShellState): number {
  return s.stack.length;
}

/** Whether `id` is anywhere on the stack (not necessarily on top). */
export function contains(s: ShellState, id: ScreenId): boolean {
  return s.stack.includes(id);
}

/**
 * Go one level deeper. Pushing the screen that is ALREADY on top is a no-op
 * (returns the same object) — a double-fired button or a key-repeat must not
 * stack two identical screens the player then has to dismiss twice.
 */
export function push(s: ShellState, id: ScreenId): ShellState {
  if (topOf(s) === id) return s;
  return { stack: [...s.stack, id], transition: s.transition };
}

/**
 * Come back out one level. Popping an empty stack is a no-op (returns the same
 * object) — "Esc on the bare HUD" is the caller's decision to make, not an
 * error state to guard against here.
 */
export function pop(s: ShellState): ShellState {
  if (s.stack.length === 0) return s;
  return { stack: s.stack.slice(0, -1), transition: s.transition };
}

/** Swap the top screen for another at the SAME depth (title → loading, without
 *  leaving a title underneath to pop back to). Replacing on an empty stack is
 *  equivalent to a push. */
export function replace(s: ShellState, id: ScreenId): ShellState {
  if (s.stack.length === 0) return { stack: [id], transition: s.transition };
  if (topOf(s) === id) return s;
  return { stack: [...s.stack.slice(0, -1), id], transition: s.transition };
}

/** Discard the whole stack and set it to exactly `ids` (empty ⇒ the HUD),
 *  clearing any transition too. Used by quit-to-title and by world-start,
 *  which must not leave stale screens (or a stray cloud overlay) buried under
 *  the new one. */
export function reset(ids: readonly ScreenId[] = []): ShellState {
  return { stack: [...ids], transition: null };
}

/**
 * Begin a sky-cloud transition: discards the whole stack (the same "nothing
 * survives underneath" rule `reset` follows — a pause menu or confirm dialog
 * open when quit fires must not stay drawn over the billowing cloud) and
 * starts the phase clock at `startedAtMs`.
 */
export function beginTransition(
  kind: TransitionKind, startedAtMs: number, durationMs: number,
): ShellState {
  return { stack: [], transition: { kind, startedAtMs, durationMs } };
}

/** Drop the active transition. A no-op returning the SAME object when there
 *  isn't one, matching every other reducer's identity-stable no-op. */
export function clearTransition(s: ShellState): ShellState {
  if (!s.transition) return s;
  return { stack: s.stack, transition: null };
}

/**
 * Click-to-skip: rewinds `startedAtMs` so `transitionPhase` reads 1 as of
 * `nowMs`, without touching `kind`/`durationMs` — the transition still reports
 * as active for one more read (its owner is what notices phase 1 and reacts,
 * e.g. forcing the ascent's reset), it just jumps straight there. A no-op
 * when there isn't one.
 */
export function skipTransition(s: ShellState, nowMs: number): ShellState {
  if (!s.transition) return s;
  return { stack: s.stack, transition: { ...s.transition, startedAtMs: nowMs - s.transition.durationMs } };
}

/**
 * Linear 0..1 progress through `t` at `nowMs` — pure (the caller's clock is an
 * explicit argument, the `rotationIndex`/chronicle idiom), so a test can step
 * it with no fake timers. Clamped both ends: a transition never "un-completes"
 * past 1, and a clock that ticks backward (a resumed tab) never goes negative.
 */
export function transitionPhase(t: TransitionState, nowMs: number): number {
  if (t.durationMs <= 0) return 1;
  return Math.max(0, Math.min(1, (nowMs - t.startedAtMs) / t.durationMs));
}
