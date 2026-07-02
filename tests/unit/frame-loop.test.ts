import { describe, it, expect, beforeEach } from 'vitest';
import { FrameLoop, AMBIENT_INTERVAL_MS, type FrameAnimating, type FrameLoopHooks } from '@/game/frame-loop';

/** A controllable rAF: queued callbacks fire only when we call flush(), so tests drive the
 *  loop deterministically and can assert on whether the loop rescheduled (idled or not). */
function fakeClock() {
  let id = 0;
  let t = 0;
  const pending = new Map<number, (now: number) => void>();
  return {
    raf: (cb: (now: number) => void) => { const i = ++id; pending.set(i, cb); return i; },
    caf: (i: number) => { pending.delete(i); },
    now: () => t,
    /** Advance time and fire exactly the frames queued at flush time (so a frame that
     *  reschedules enqueues the NEXT one, fired on the following flush). */
    flush(dt = 16) {
      t += dt;
      const batch = [...pending.entries()];
      pending.clear();
      for (const [, cb] of batch) cb(t);
    },
    queued: () => pending.size,
  };
}

function makeHooks(over: Partial<FrameLoopHooks> = {}) {
  const calls = { frame: 0, render: 0, pause: [] as boolean[] };
  let animating: FrameAnimating = false;
  const hooks: FrameLoopHooks = {
    onFrame: (_n, _d, _p) => { calls.frame++; return animating; },
    onRender: () => { calls.render++; },
    onPauseChange: (p) => { calls.pause.push(p); },
    ...over,
  };
  return { hooks, calls, setAnimating: (v: FrameAnimating) => { animating = v; } };
}

describe('FrameLoop', () => {
  let clock: ReturnType<typeof fakeClock>;
  beforeEach(() => { clock = fakeClock(); });

  it('an animating world reschedules every frame (continuous loop)', () => {
    const { hooks, calls, setAnimating } = makeHooks();
    setAnimating(true);
    const loop = new FrameLoop(hooks, clock);
    loop.start();
    expect(clock.queued()).toBe(1);
    clock.flush();
    expect(calls.frame).toBe(1);
    expect(calls.render).toBe(1);     // animating ⇒ renders
    expect(clock.queued()).toBe(1);   // rescheduled
    clock.flush();
    expect(calls.frame).toBe(2);
    expect(clock.queued()).toBe(1);   // still going
  });

  it('an idle (non-animating) world renders one frame then STOPS — the machine rests', () => {
    const { hooks, calls } = makeHooks(); // animating stays false
    const loop = new FrameLoop(hooks, clock);
    loop.start();
    clock.flush();
    expect(calls.frame).toBe(1);
    expect(calls.render).toBe(1);     // first frame draws (needsRender starts true)
    expect(clock.queued()).toBe(0);   // did NOT reschedule → idle
    // A subsequent flush fires nothing (no frame queued).
    clock.flush();
    expect(calls.frame).toBe(1);
  });

  it('requestRender kicks exactly one on-demand frame while idle', () => {
    const { hooks, calls } = makeHooks();
    const loop = new FrameLoop(hooks, clock);
    loop.start();
    clock.flush();                    // first frame, then idle
    expect(clock.queued()).toBe(0);
    loop.requestRender();
    expect(clock.queued()).toBe(1);   // kicked
    clock.flush();
    expect(calls.frame).toBe(2);
    expect(calls.render).toBe(2);
    expect(clock.queued()).toBe(0);   // back to idle (still not animating)
    // requestRender while a frame is already queued does not double-queue.
    loop.requestRender();
    loop.requestRender();
    expect(clock.queued()).toBe(1);
  });

  it("'ambient' keeps the loop running but renders at the reduced cadence", () => {
    const { hooks, calls, setAnimating } = makeHooks();
    setAnimating('ambient');
    const loop = new FrameLoop(hooks, clock);
    loop.start();
    clock.flush();                    // frame 1: first render (needsRender starts true)
    expect(calls.render).toBe(1);
    expect(clock.queued()).toBe(1);   // ambient ⇒ loop keeps running
    clock.flush();                    // +16ms — inside the ambient interval → no render
    clock.flush();                    // +32ms — still inside
    expect(calls.frame).toBe(3);      // onFrame ran every frame (sim/audio stay fed)
    expect(calls.render).toBe(1);     // but no extra draw yet
    clock.flush();                    // +48ms ≥ AMBIENT_INTERVAL_MS → renders
    expect(calls.render).toBe(2);
    expect(clock.queued()).toBe(1);   // still looping
    // Sanity: the constant this cadence is built on stays in the every-3rd-frame band.
    expect(AMBIENT_INTERVAL_MS).toBeGreaterThan(32);
    expect(AMBIENT_INTERVAL_MS).toBeLessThanOrEqual(48);
  });

  it('requestRender bypasses the ambient throttle (interaction stays instant)', () => {
    const { hooks, calls, setAnimating } = makeHooks();
    setAnimating('ambient');
    const loop = new FrameLoop(hooks, clock);
    loop.start();
    clock.flush();                    // first render
    expect(calls.render).toBe(1);
    loop.requestRender();             // e.g. a pan/zoom/hover
    clock.flush();                    // +16ms — throttled window, but needsRender wins
    expect(calls.render).toBe(2);
  });

  it("full-rate animating (true) is never throttled", () => {
    const { hooks, calls, setAnimating } = makeHooks();
    setAnimating(true);
    const loop = new FrameLoop(hooks, clock);
    loop.start();
    clock.flush();
    clock.flush();
    clock.flush();
    expect(calls.render).toBe(3);     // every frame draws
  });

  it('setPaused(true) fires onPauseChange, draws one frame, then idles; resume restarts', () => {
    const { hooks, calls, setAnimating } = makeHooks();
    setAnimating(true);               // a live world
    const loop = new FrameLoop(hooks, clock);
    loop.start();
    clock.flush();                    // running
    loop.setPaused(true);
    expect(loop.isPaused()).toBe(true);
    expect(calls.pause).toEqual([true]);
    // The paused frame is rendered even though onFrame now reports not-animating.
    setAnimating(false);
    const beforeRender = calls.render;
    clock.flush();
    expect(calls.render).toBe(beforeRender + 1); // one pending frame drawn
    expect(clock.queued()).toBe(0);              // then idle (paused)
    // Resume.
    loop.setPaused(false);
    setAnimating(true);
    expect(calls.pause).toEqual([true, false]);
    expect(clock.queued()).toBe(1);
  });

  it('setPaused is idempotent — same state does not re-fire the hook', () => {
    const { hooks, calls } = makeHooks();
    const loop = new FrameLoop(hooks, clock);
    loop.setPaused(true);
    loop.setPaused(true);
    expect(calls.pause).toEqual([true]);
  });

  it('tab hidden auto-pauses; becoming visible resumes only an auto-pause', () => {
    const { hooks, calls } = makeHooks();
    const loop = new FrameLoop(hooks, clock);
    loop.handleVisibility(true);      // hidden
    expect(loop.isPaused()).toBe(true);
    loop.handleVisibility(false);     // visible → auto-resume
    expect(loop.isPaused()).toBe(false);
    expect(calls.pause).toEqual([true, false]);
  });

  it('a MANUAL pause is not auto-resumed when the tab becomes visible', () => {
    const { hooks } = makeHooks();
    const loop = new FrameLoop(hooks, clock);
    loop.setPaused(true);             // manual
    loop.handleVisibility(true);      // already paused → no-op
    loop.handleVisibility(false);     // visible, but pause was manual → stays paused
    expect(loop.isPaused()).toBe(true);
  });

  it('destroy() stops the loop and refuses to reschedule or kick', () => {
    const { hooks, setAnimating } = makeHooks();
    setAnimating(true);
    const loop = new FrameLoop(hooks, clock);
    loop.start();
    expect(clock.queued()).toBe(1);
    loop.destroy();
    expect(clock.queued()).toBe(0);   // pending frame cancelled
    loop.requestRender();
    expect(clock.queued()).toBe(0);   // destroyed → no kick
    loop.start();
    expect(clock.queued()).toBe(0);   // destroyed → no restart
  });
});
