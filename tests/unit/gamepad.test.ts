import { describe, it, expect } from 'vitest';
import {
  gamepadEdges, initRepeatState, applyDeadzone, stickVector, triggerZoomAxis,
  GamepadPoller, GP_BUTTON, DPAD_REPEAT_DELAY_MS, DPAD_REPEAT_INTERVAL_MS,
  STICK_DEADZONE, TRIGGER_DEADZONE, type GamepadNavigator,
} from '@/game/input/gamepad';

function buttons(pressed: Partial<Record<number, boolean>>, count = 17): boolean[] {
  const arr = new Array(count).fill(false);
  for (const [k, v] of Object.entries(pressed)) arr[Number(k)] = !!v;
  return arr;
}

describe('gamepadEdges — press/release/hold/repeat (pure)', () => {
  it('a fresh press (prev null) fires once', () => {
    const next = buttons({ [GP_BUTTON.A]: true });
    const { actions } = gamepadEdges(null, next, 0, initRepeatState());
    expect(actions).toEqual(['confirm']);
  });

  it('a button newly pressed since the last poll fires exactly once', () => {
    const prev = buttons({});
    const next = buttons({ [GP_BUTTON.B]: true });
    const { actions } = gamepadEdges(prev, next, 0, initRepeatState());
    expect(actions).toEqual(['cancel']);
  });

  it('holding a NON-repeatable button (A/B) fires nothing on subsequent polls', () => {
    const held = buttons({ [GP_BUTTON.A]: true });
    const first = gamepadEdges(null, held, 0, initRepeatState());
    expect(first.actions).toEqual(['confirm']);
    const second = gamepadEdges(held, held, 50, first.repeat);
    expect(second.actions).toEqual([]);
    const third = gamepadEdges(held, held, 10_000, second.repeat);
    expect(third.actions).toEqual([]); // never repeats, no matter how long held
  });

  it('releasing a button fires nothing (no "release" action)', () => {
    const held = buttons({ [GP_BUTTON.A]: true });
    const released = buttons({});
    const { actions } = gamepadEdges(held, released, 100, initRepeatState());
    expect(actions).toEqual([]);
  });

  it('holding DPAD_DOWN repeats after the initial delay, then at the steady interval', () => {
    const held = buttons({ [GP_BUTTON.DPAD_DOWN]: true });
    let state = initRepeatState();
    const press = gamepadEdges(null, held, 0, state);
    expect(press.actions).toEqual(['menu_down']);
    state = press.repeat;

    // Before the delay elapses: no repeat yet.
    const tooSoon = gamepadEdges(held, held, DPAD_REPEAT_DELAY_MS - 1, state);
    expect(tooSoon.actions).toEqual([]);

    // Exactly at the delay: first repeat fires.
    const firstRepeat = gamepadEdges(held, held, DPAD_REPEAT_DELAY_MS, state);
    expect(firstRepeat.actions).toEqual(['menu_down']);
    state = firstRepeat.repeat;

    // Before the interval elapses again: nothing.
    const tooSoon2 = gamepadEdges(held, held, DPAD_REPEAT_DELAY_MS + DPAD_REPEAT_INTERVAL_MS - 1, state);
    expect(tooSoon2.actions).toEqual([]);

    // At the interval: repeats again.
    const secondRepeat = gamepadEdges(held, held, DPAD_REPEAT_DELAY_MS + DPAD_REPEAT_INTERVAL_MS, state);
    expect(secondRepeat.actions).toEqual(['menu_down']);
  });

  it('releasing and re-pressing a repeatable button resets its repeat timer (fresh press, not a stale repeat)', () => {
    const held = buttons({ [GP_BUTTON.DPAD_UP]: true });
    const released = buttons({});
    let state = initRepeatState();
    state = gamepadEdges(null, held, 0, state).repeat;
    state = gamepadEdges(held, released, 10, state).repeat; // release before the delay elapses
    const rePress = gamepadEdges(released, held, 20, state);
    expect(rePress.actions).toEqual(['menu_up']); // a fresh press, not a leftover repeat
  });

  it('multiple simultaneous fresh presses all fire, in BUTTON_ACTION declaration order', () => {
    const next = buttons({ [GP_BUTTON.A]: true, [GP_BUTTON.DPAD_UP]: true });
    const { actions } = gamepadEdges(null, next, 0, initRepeatState());
    expect(actions).toEqual(['confirm', 'menu_up']);
  });

  it('an unmapped button (e.g. X/Y) never produces an action', () => {
    const next = buttons({ [GP_BUTTON.X]: true, [GP_BUTTON.Y]: true, [GP_BUTTON.LB]: true });
    const { actions } = gamepadEdges(null, next, 0, initRepeatState());
    expect(actions).toEqual([]);
  });
});

describe('applyDeadzone', () => {
  it('collapses anything inside the deadzone to exactly 0', () => {
    expect(applyDeadzone(0, 0.2)).toBe(0);
    expect(applyDeadzone(0.19, 0.2)).toBe(0);
    expect(applyDeadzone(-0.19, 0.2)).toBe(0);
  });

  it('ramps smoothly from 0 at the deadzone edge to ±1 at full deflection', () => {
    expect(applyDeadzone(0.2, 0.2)).toBeCloseTo(0, 6);
    expect(applyDeadzone(1, 0.2)).toBeCloseTo(1, 6);
    expect(applyDeadzone(-1, 0.2)).toBeCloseTo(-1, 6);
    const mid = applyDeadzone(0.6, 0.2); // halfway between 0.2 and 1.0
    expect(mid).toBeCloseTo(0.5, 6);
  });
});

describe('stickVector', () => {
  it('deadzones both axes independently', () => {
    expect(stickVector([0.05, 0.9])).toEqual({ dx: 0, dy: applyDeadzone(0.9, STICK_DEADZONE) });
  });
  it('defaults missing axes to centred', () => {
    expect(stickVector([])).toEqual({ dx: 0, dy: 0 });
  });
});

describe('triggerZoomAxis', () => {
  it('RT alone zooms in (positive)', () => {
    const bs = [] as { value?: number; pressed?: boolean }[];
    bs[GP_BUTTON.RT] = { value: 1, pressed: true };
    expect(triggerZoomAxis(bs)).toBeCloseTo(1, 6);
  });
  it('LT alone zooms out (negative)', () => {
    const bs = [] as { value?: number; pressed?: boolean }[];
    bs[GP_BUTTON.LT] = { value: 1, pressed: true };
    expect(triggerZoomAxis(bs)).toBeCloseTo(-1, 6);
  });
  it('both pulled equally cancel to 0', () => {
    const bs = [] as { value?: number; pressed?: boolean }[];
    bs[GP_BUTTON.LT] = { value: 0.7 };
    bs[GP_BUTTON.RT] = { value: 0.7 };
    expect(triggerZoomAxis(bs)).toBe(0);
  });
  it('falls back to digital .pressed when .value is absent (non-analog triggers)', () => {
    const bs = [] as { value?: number; pressed?: boolean }[];
    bs[GP_BUTTON.RT] = { pressed: true };
    expect(triggerZoomAxis(bs)).toBeGreaterThan(0);
  });
  it('below the trigger deadzone reads as 0', () => {
    const bs = [] as { value?: number; pressed?: boolean }[];
    bs[GP_BUTTON.RT] = { value: TRIGGER_DEADZONE - 0.001 };
    expect(triggerZoomAxis(bs)).toBe(0);
  });
});

describe('GamepadPoller — the only piece that touches navigator', () => {
  it('is a complete no-op when getGamepads is absent (Node/tests, or an unsupported browser)', () => {
    const nav: GamepadNavigator = {};
    const poller = new GamepadPoller(nav);
    expect(() => poller.poll(0)).not.toThrow();
    expect(poller.poll(0)).toBeNull();
  });

  it('is a complete no-op when the navigator itself is undefined', () => {
    const poller = new GamepadPoller(undefined);
    expect(poller.poll(0)).toBeNull();
  });

  it('returns null when getGamepads() reports no connected pad', () => {
    const nav: GamepadNavigator = { getGamepads: () => [null, null] };
    const poller = new GamepadPoller(nav);
    expect(poller.poll(0)).toBeNull();
  });

  it('never throws even if getGamepads() itself throws', () => {
    const nav: GamepadNavigator = {
      getGamepads: () => { throw new Error('boom'); },
    };
    const poller = new GamepadPoller(nav);
    expect(() => poller.poll(0)).not.toThrow();
    expect(poller.poll(0)).toBeNull();
  });

  function fakePad(overrides: Partial<Gamepad> = {}): Gamepad {
    return {
      id: 'fake', index: 0, connected: true, timestamp: 0, mapping: 'standard',
      axes: [0, 0, 0, 0],
      buttons: new Array(17).fill(0).map(() => ({ pressed: false, touched: false, value: 0 })),
      vibrationActuator: null,
      hapticActuators: [],
      ...overrides,
    } as unknown as Gamepad;
  }

  it('reports a fresh press on the first poll after a pad connects', () => {
    const btns = fakePad().buttons.slice() as { pressed: boolean; touched: boolean; value: number }[];
    btns[GP_BUTTON.A] = { pressed: true, touched: true, value: 1 };
    const nav: GamepadNavigator = { getGamepads: () => [fakePad({ buttons: btns as unknown as GamepadButton[] })] };
    const poller = new GamepadPoller(nav);
    const frame = poller.poll(0);
    expect(frame?.actions).toEqual(['confirm']);
  });

  it('threads left-stick + trigger state through to pan/zoomAxis', () => {
    const nav: GamepadNavigator = {
      getGamepads: () => [fakePad({ axes: [1, -1, 0, 0] })],
    };
    const poller = new GamepadPoller(nav);
    const frame = poller.poll(0);
    expect(frame?.pan.dx).toBeCloseTo(1, 6);
    expect(frame?.pan.dy).toBeCloseTo(-1, 6);
    expect(frame?.zoomAxis).toBe(0); // no trigger deflection
  });

  it('resets repeat state on disconnect so a reconnect does not phantom-repeat', () => {
    let connected = true;
    const btns = fakePad().buttons.slice() as { pressed: boolean; touched: boolean; value: number }[];
    btns[GP_BUTTON.DPAD_UP] = { pressed: true, touched: true, value: 1 };
    const nav: GamepadNavigator = {
      getGamepads: () => connected ? [fakePad({ buttons: btns as unknown as GamepadButton[] })] : [null],
    };
    const poller = new GamepadPoller(nav);
    expect(poller.poll(0)?.actions).toEqual(['menu_up']);
    connected = false;
    expect(poller.poll(1)).toBeNull();
    connected = true;
    // Reconnect with the same button already held: a FRESH press, not a repeat tick.
    expect(poller.poll(2)?.actions).toEqual(['menu_up']);
  });
});
