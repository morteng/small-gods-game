// src/game/input/gamepad.ts
//
// Gamepad input (UI v3 P5). The Gamepad API has no events — a pad's state can
// only be READ, so the frame loop polls it once per frame (`GamepadPoller.poll`,
// called from `Game.onFrame`) instead of the "listener soup" every other input
// source in this codebase uses. Buttons map onto the SAME `Action` set
// `keymap.ts` defines for the keyboard; menu navigation dispatches through the
// SAME `UiContext` focus ring (`focusNext`/`focusPrev`/`activate`) the keyboard
// would drive if Tab/Enter reached it — one implementation, two input devices.
//
// Only `GamepadPoller.poll` touches `navigator`; `gamepadEdges`/`applyDeadzone`/
// `stickVector`/`triggerZoomAxis` are pure functions of a plain snapshot, so the
// interesting logic (press/release/hold/repeat/deadzone) is Node-testable
// without a real `Gamepad` object.

import type { Action } from '@/game/input/keymap';

/** Standard Gamepad API mapping button indices we care about (the W3C
 *  "standard" layout every modern pad reports itself as when it can). */
export const GP_BUTTON = {
  A: 0, B: 1, X: 2, Y: 3,
  LB: 4, RB: 5, LT: 6, RT: 7,
  BACK: 8, START: 9, LS: 10, RS: 11,
  DPAD_UP: 12, DPAD_DOWN: 13, DPAD_LEFT: 14, DPAD_RIGHT: 15,
  HOME: 16,
} as const;

/** Buttons that drive the shared `Action`/focus-ring vocabulary. Left/right
 *  shoulders and triggers are handled separately (continuous zoom, not a
 *  discrete action); the two sticks are continuous camera pan, likewise. */
const BUTTON_ACTION: ReadonlyMap<number, Action> = new Map([
  [GP_BUTTON.A, 'confirm'],
  [GP_BUTTON.B, 'cancel'],
  [GP_BUTTON.DPAD_UP, 'menu_up'],
  [GP_BUTTON.DPAD_DOWN, 'menu_down'],
  [GP_BUTTON.DPAD_LEFT, 'menu_left'],
  [GP_BUTTON.DPAD_RIGHT, 'menu_right'],
]);

/** Dpad directions repeat while held (console-menu convention: hold down to
 *  walk a long list); A/B fire once per press only — repeatedly re-activating
 *  a button on hold would be surprising, repeatedly stepping focus is not. */
const REPEATABLE = new Set<number>([
  GP_BUTTON.DPAD_UP, GP_BUTTON.DPAD_DOWN, GP_BUTTON.DPAD_LEFT, GP_BUTTON.DPAD_RIGHT,
]);

// Real ms — this game's time-constant rule (CLAUDE.md): input timing is
// wall-clock, never sim ticks.
/** How long a dpad direction must be held before it starts repeating. */
export const DPAD_REPEAT_DELAY_MS = 400;
/** Steady-state interval between repeats while a dpad direction stays held. */
export const DPAD_REPEAT_INTERVAL_MS = 120;
/** Stick deflection below this (0..1 magnitude) reads as centred — absorbs
 *  analog-stick drift/noise near rest. */
export const STICK_DEADZONE = 0.2;
/** Trigger deflection below this reads as released — cheap triggers rest
 *  slightly above 0. */
export const TRIGGER_DEADZONE = 0.08;

/** Per-button "when did this become held, and when does it next repeat"
 *  state, durable across polls. The caller (`GamepadPoller`) owns one of
 *  these per physical pad; `gamepadEdges` only ever reads/returns a fresh
 *  copy, never mutates the one it's given. */
export interface RepeatState {
  nextRepeatMs: Readonly<Partial<Record<number, number>>>;
}
export function initRepeatState(): RepeatState {
  return { nextRepeatMs: {} };
}

export interface GamepadEdgesResult {
  /** Actions that fired on THIS poll: a fresh press, or a due repeat tick for
   *  a held repeatable button. Order follows `BUTTON_ACTION`'s declaration. */
  actions: Action[];
  /** Updated repeat bookkeeping — feed this back in as `repeat` on the NEXT
   *  poll (the caller threads it; this function never mutates in place). */
  repeat: RepeatState;
}

/**
 * Pure diff of two button-pressed snapshots into fired `Action` edges.
 * `prev` is `null` on the very first poll (or right after a pad reconnects) —
 * every currently-pressed button is treated as a FRESH press, never a
 * same-frame phantom repeat, since there is no prior frame to compare against.
 * `nowMs` drives repeat timing and must be a monotonically increasing
 * real-ms clock (the rAF timestamp) — never a sim tick.
 */
export function gamepadEdges(
  prev: readonly boolean[] | null,
  next: readonly boolean[],
  nowMs: number,
  repeat: RepeatState,
): GamepadEdgesResult {
  const actions: Action[] = [];
  const nextRepeatMs: Partial<Record<number, number>> = { ...repeat.nextRepeatMs };

  for (const [idx, action] of BUTTON_ACTION) {
    const was = prev?.[idx] ?? false;
    const is = next[idx] ?? false;
    if (is && !was) {
      actions.push(action);
      if (REPEATABLE.has(idx)) nextRepeatMs[idx] = nowMs + DPAD_REPEAT_DELAY_MS;
    } else if (is && was && REPEATABLE.has(idx)) {
      const due = nextRepeatMs[idx];
      if (due !== undefined && nowMs >= due) {
        actions.push(action);
        nextRepeatMs[idx] = nowMs + DPAD_REPEAT_INTERVAL_MS;
      }
    } else if (!is) {
      delete nextRepeatMs[idx];
    }
  }

  return { actions, repeat: { nextRepeatMs } };
}

/** Rescale `v` (any signed magnitude) so it ramps smoothly from 0 at the
 *  deadzone edge to ±1 at full deflection, instead of jumping straight to a
 *  nonzero value the instant `|v|` crosses `dz` (which would read as a twitch
 *  on real hardware, whose rest position rarely reports exactly 0). */
export function applyDeadzone(v: number, dz: number): number {
  const mag = Math.abs(v);
  if (mag < dz || dz >= 1) return 0;
  const sign = Math.sign(v);
  return sign * ((mag - dz) / (1 - dz));
}

export interface StickVector { dx: number; dy: number }

/** Left stick → camera pan (continuous, not part of the `Action` set —
 *  panning isn't a discrete "press", it's a magnitude every frame). */
export function stickVector(axes: readonly number[], deadzone = STICK_DEADZONE): StickVector {
  return {
    dx: applyDeadzone(axes[0] ?? 0, deadzone),
    dy: applyDeadzone(axes[1] ?? 0, deadzone),
  };
}

/** Trigger pair → a single -1..1 zoom axis (RT zooms in, LT zooms out;
 *  pulling both cancels out). Reads the analog `.value` when the pad reports
 *  one; falls back to the boolean digital `.pressed` (1/0) for pads whose
 *  triggers aren't analog. */
export function triggerZoomAxis(
  buttons: readonly { value?: number; pressed?: boolean }[],
  deadzone = TRIGGER_DEADZONE,
): number {
  const read = (b: { value?: number; pressed?: boolean } | undefined): number =>
    b ? (b.value ?? (b.pressed ? 1 : 0)) : 0;
  const lt = read(buttons[GP_BUTTON.LT]);
  const rt = read(buttons[GP_BUTTON.RT]);
  return applyDeadzone(rt - lt, deadzone);
}

/** One poll's worth of gamepad input, ready for `Game` to apply. */
export interface GamepadFrame {
  actions: Action[];
  pan: StickVector;
  /** -1 (zoom out) .. 1 (zoom in), deadzoned. */
  zoomAxis: number;
}

/** The subset of `navigator` this module needs — narrowed so tests can hand
 *  in a fake without pulling in DOM lib types. */
export interface GamepadNavigator {
  getGamepads?: () => (Gamepad | null)[];
}

/**
 * Stateful per-pad poller. `poll` is a COMPLETE no-op — never throws, returns
 * `null` — when `navigator.getGamepads` is absent (Node/tests, or a browser
 * without gamepad support) or no pad is currently connected; that is the
 * common case, so the frame loop calling this every frame costs nothing
 * extra when nobody owns a controller.
 */
export class GamepadPoller {
  private prevButtons: readonly boolean[] | null = null;
  private repeat: RepeatState = initRepeatState();

  constructor(private readonly nav: GamepadNavigator | undefined =
    typeof navigator !== 'undefined' ? (navigator as unknown as GamepadNavigator) : undefined) {}

  poll(nowMs: number): GamepadFrame | null {
    const getGamepads = this.nav?.getGamepads;
    if (!getGamepads) return null;
    let pads: (Gamepad | null)[];
    try {
      pads = getGamepads.call(this.nav) ?? [];
    } catch {
      return null;
    }
    const pad = pads.find((p): p is Gamepad => p != null);
    if (!pad) {
      // No pad right now (never connected, or just disconnected) — reset so a
      // future reconnect starts clean (no phantom repeats from stale state).
      this.prevButtons = null;
      this.repeat = initRepeatState();
      return null;
    }

    const buttons = pad.buttons.map((b) => b.pressed);
    const { actions, repeat } = gamepadEdges(this.prevButtons, buttons, nowMs, this.repeat);
    this.prevButtons = buttons;
    this.repeat = repeat;

    return {
      actions,
      pan: stickVector(pad.axes as readonly number[]),
      zoomAxis: triggerZoomAxis(pad.buttons as readonly { value?: number; pressed?: boolean }[]),
    };
  }
}
