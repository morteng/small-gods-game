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

/** The shell's whole state. `stack` is ordered outermost-first, so the LAST
 *  entry is what the player is looking at. Empty ⇒ the in-game HUD. */
export interface ShellState {
  readonly stack: readonly ScreenId[];
}

/** No screen — the in-game HUD owns the frame. */
export const EMPTY_SHELL: ShellState = { stack: [] };

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
  return { stack: [...s.stack, id] };
}

/**
 * Come back out one level. Popping an empty stack is a no-op (returns the same
 * object) — "Esc on the bare HUD" is the caller's decision to make, not an
 * error state to guard against here.
 */
export function pop(s: ShellState): ShellState {
  if (s.stack.length === 0) return s;
  return { stack: s.stack.slice(0, -1) };
}

/** Swap the top screen for another at the SAME depth (title → loading, without
 *  leaving a title underneath to pop back to). Replacing on an empty stack is
 *  equivalent to a push. */
export function replace(s: ShellState, id: ScreenId): ShellState {
  if (s.stack.length === 0) return { stack: [id] };
  if (topOf(s) === id) return s;
  return { stack: [...s.stack.slice(0, -1), id] };
}

/** Discard the whole stack and set it to exactly `ids` (empty ⇒ the HUD). Used
 *  by quit-to-title and by world-start, which must not leave stale screens
 *  buried under the new one. */
export function reset(ids: readonly ScreenId[] = []): ShellState {
  return { stack: [...ids] };
}
