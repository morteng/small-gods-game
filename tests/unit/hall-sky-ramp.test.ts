import { describe, it, expect } from 'vitest';
import { Shell } from '@/render/ui/shell/shell';
import {
  stepHallOverlay, coverageFor, HALL_RAMP_MS, type HallRampStep,
} from '@/game/sky-transition';

// Phase C slice H4 — the HALL sits above the clouds. `stepHallOverlay` is the
// whole mechanism: a pure per-frame step that closes the sky-backdrop overlay
// while the hall owns the frame and re-opens it after the hall pops, and that
// composes with a REAL descent/ascent instead of racing it. No Game, no GPU —
// the two things that can actually hurt a player here (the world peeking
// through an open hall, and a ramp left dangling after quit-to-title) are both
// decidable from these arguments alone.

/** Run `frames` steps of `stepMs` each, carrying the ramp position forward. */
function drive(
  frames: readonly { open: boolean; transitionCoverage?: number | null }[],
  stepMs: number,
  from = 0,
): HallRampStep[] {
  let linear01 = from;
  const out: HallRampStep[] = [];
  for (const f of frames) {
    const step = stepHallOverlay({
      transitionCoverage: f.transitionCoverage ?? null,
      hallOpen: f.open,
      linear01,
      deltaMs: stepMs,
    });
    linear01 = step.linear01;
    out.push(step);
  }
  return out;
}

const frames = (n: number, open: boolean, transitionCoverage: number | null = null) =>
  Array.from({ length: n }, () => ({ open, transitionCoverage }));

describe('hall sky ramp — closing the sky above the world', () => {
  it('a CLEAR sky with no hall and no transition asks for NO overlay at all', () => {
    // null, not 0: coverage 0 would still run the cloud pass every frame for a
    // sky that is fully revealed anyway.
    const [s] = drive([{ open: false }], 16);
    expect(s.coverage).toBeNull();
    expect(s.linear01).toBe(0);
    expect(s.animating).toBe(false);
  });

  it('ramps 0 -> FULL cover over HALL_RAMP_MS once the hall is up', () => {
    const steps = drive(frames(7, true), HALL_RAMP_MS / 7);
    // monotonically non-decreasing, and every frame in range
    let prev = -1;
    for (const s of steps) {
      const cov = s.coverage ?? 0;
      expect(cov).toBeGreaterThanOrEqual(prev);
      expect(cov).toBeLessThanOrEqual(1);
      prev = cov;
    }
    const last = steps[steps.length - 1];
    // THE invariant: at ramp end the coverage is a genuine 1.0, so the cloud
    // pass fully occludes the running world — never a 0.98 the world shows
    // through.
    expect(last.linear01).toBe(1);
    expect(last.coverage).toBe(1);
    expect(last.animating).toBe(false);
  });

  it('the ramp EASES OUT — most of the cover arrives early (the same curve the transitions use)', () => {
    const half = drive(frames(1, true), HALL_RAMP_MS / 2)[0];
    expect(half.coverage!).toBeGreaterThan(0.5);
  });

  it('stays fully covered while the hall stays up (no drift, no re-animation)', () => {
    const held = drive(frames(5, true), 16, 1);
    for (const s of held) {
      expect(s.linear01).toBe(1);
      expect(s.coverage).toBe(1);
      expect(s.animating).toBe(false);
    }
  });

  it('re-opens the sky after the hall pops, and settles back to NO overlay', () => {
    const steps = drive(frames(7, false), HALL_RAMP_MS / 7, 1);
    let prev = 2;
    for (const s of steps.slice(0, -1)) {
      expect(s.coverage!).toBeLessThan(prev);
      prev = s.coverage!;
    }
    const last = steps[steps.length - 1];
    expect(last.linear01).toBe(0);
    expect(last.coverage).toBeNull();  // no residual haze, no wasted pass
    expect(last.animating).toBe(false);
  });

  it('reports animating until it ARRIVES, so the frame loop keeps drawing', () => {
    const mid = drive(frames(1, true), 100)[0];
    expect(mid.animating).toBe(true);
    expect(drive(frames(1, true), 100, 1)[0].animating).toBe(false);
  });

  it('a long gap (tab hidden, hard pause) snaps to the target without overshooting', () => {
    expect(drive(frames(1, true), 60_000)[0].linear01).toBe(1);
    expect(drive(frames(1, false), 60_000, 1)[0].linear01).toBe(0);
  });

  it('is defensive about garbage inputs rather than propagating NaN into a uniform', () => {
    expect(drive(frames(1, true), Number.NaN)[0].linear01).toBe(0);
    expect(drive(frames(1, true), -50)[0].linear01).toBe(0);
    expect(stepHallOverlay({
      transitionCoverage: null, hallOpen: true, linear01: Number.NaN, deltaMs: HALL_RAMP_MS,
    }).linear01).toBe(1);
    expect(stepHallOverlay({
      transitionCoverage: null, hallOpen: false, linear01: 9, deltaMs: 0,
    }).coverage).toBe(1);   // clamped to a full-cover ramp, not 9
  });
});

describe('hall sky ramp — a real transition owns the sky', () => {
  it('never thins a transition\'s coverage, at any ramp position', () => {
    for (const phase of [0, 0.1, 0.25, 0.5, 0.75, 1]) {
      for (const linear01 of [0, 0.3, 0.7, 1]) {
        for (const kind of ['descent', 'ascent'] as const) {
          const want = coverageFor(kind, phase);
          const got = stepHallOverlay({
            transitionCoverage: want, hallOpen: false, linear01, deltaMs: 0,
          }).coverage!;
          expect(got).toBeGreaterThanOrEqual(want);
        }
      }
    }
  });

  it('hands the transition its OWN number back once the ramp has fallen away', () => {
    // The ramp only ever falls while a transition runs with no hall on the
    // stack, so within HALL_RAMP_MS the transition is the sole author again —
    // it cannot be pinned open.
    const steps = drive(frames(8, false, 0), HALL_RAMP_MS / 7, 1);
    const last = steps[steps.length - 1];
    expect(last.linear01).toBe(0);
    expect(last.coverage).toBe(0);
  });

  it('a QUIT from an open hall keeps the sky shut instead of flashing the world', () => {
    // The wart this composition exists to prevent: `beginAscent` clears the
    // stack (so the hall stops drawing and its ramp starts falling) while the
    // ascent's own sweep is still near 0. Taking the ascent's number outright
    // would reveal the world the player had just left, mid-quit.
    let linear01 = 1;
    const ASCENT_MS = 1500;
    for (let t = 0; t <= ASCENT_MS; t += 50) {
      const step = stepHallOverlay({
        transitionCoverage: coverageFor('ascent', t / ASCENT_MS),
        hallOpen: false,
        linear01,
        deltaMs: 50,
      });
      linear01 = step.linear01;
      expect(step.coverage!).toBeGreaterThan(0.6);
    }
    expect(linear01).toBe(0);   // and nothing dangles at the far end
  });
});

describe('hall sky ramp × the real Shell', () => {
  /** Drive the ramp off a REAL `Shell`, exactly as `Game.tickShellTransition`
   *  does: the transition's coverage (if any) plus `top() === 'hall'`. */
  function harness() {
    let nowMs = 0;
    let linear01 = 0;
    const shell = new Shell({ now: () => nowMs });
    const tick = (deltaMs: number): HallRampStep => {
      nowMs += deltaMs;
      const t = shell.transition();
      const phase = t ? shell.transitionPhase(nowMs) ?? 1 : null;
      const step = stepHallOverlay({
        transitionCoverage: t && phase !== null ? coverageFor(t.kind, phase) : null,
        hallOpen: shell.top() === 'hall',
        linear01,
        deltaMs,
      });
      linear01 = step.linear01;
      return step;
    };
    return { shell, tick, at: () => linear01 };
  }

  it('open_screen hall closes the sky; Esc/BACK opens it again', () => {
    const { shell, tick } = harness();
    shell.reset([]);                       // the in-world HUD owns the frame
    expect(tick(16).coverage).toBeNull();

    shell.push('hall');
    expect(tick(HALL_RAMP_MS).coverage).toBe(1);

    shell.pop();                           // back to the HUD
    const reopened = tick(HALL_RAMP_MS);
    expect(reopened.coverage).toBeNull();
    expect(reopened.linear01).toBe(0);
  });

  it('quit-to-title from inside the hall leaves NO dangling ramp', () => {
    const { shell, tick, at } = harness();
    shell.reset([]);
    shell.push('hall');
    tick(HALL_RAMP_MS);
    expect(at()).toBe(1);

    // `beginAscent` clears the stack outright — the hall is gone as a SCREEN
    // the same frame the quit starts, so the ramp has to unwind itself.
    shell.beginAscent();
    expect(shell.top()).toBeNull();   // the stack is cleared outright
    for (let i = 0; i < 20; i++) tick(HALL_RAMP_MS / 4);
    expect(at()).toBe(0);
  });

  it('another screen on top of the hall is not the hall — the sky re-opens', () => {
    // `top()`, not `has()`: the ramp tracks what actually owns the frame, so a
    // screen pushed over the hall does not inherit its sky.
    const { shell, tick } = harness();
    shell.reset([]);
    shell.push('hall');
    tick(HALL_RAMP_MS);
    shell.push('settings');
    expect(tick(HALL_RAMP_MS).coverage).toBeNull();
    shell.pop();
    expect(tick(HALL_RAMP_MS).coverage).toBe(1);
  });
});
