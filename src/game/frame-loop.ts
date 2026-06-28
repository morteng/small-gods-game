// The frame-loop driver: owns the rAF scheduling, the "real pause" (CPU + GPU idle),
// the render-on-demand gate, and the tab-visibility auto-pause. Extracted from `game.ts`
// so the loop mechanics are testable in isolation (inject `raf`/`caf`/`now`) and the Game
// coordinator only supplies the per-frame WORK via hooks.
//
// The contract that makes the machine actually rest on an old dev box:
//   - A LIVE / animating world reschedules every frame (continuous loop).
//   - A hard pause (or an idle, paused, nothing-animating world) renders ONE pending frame
//     (so a capture/grab sees it) then STOPS — `rafId` goes null, the GPU idles — until the
//     next `requestRender()` kicks a single on-demand frame.

export interface FrameLoopHooks {
  /** Advance one frame (sim + presentation). `paused` = hard-paused → render-only, no sim
   *  advance. Return true if something is still animating (live sim, water ripples, divine
   *  effects, scrub, cinematic camera) so the continuous loop should keep running. */
  onFrame(now: number, deltaMs: number, paused: boolean): boolean;
  /** Do the expensive scene render + UI refresh. Called when `onFrame` reported animating
   *  OR a one-shot `requestRender()` is pending. */
  onRender(deltaMs: number): void;
  /** Entering / leaving hard pause. The Game suspends the sim rate + mutes audio here. */
  onPauseChange(paused: boolean): void;
}

export interface FrameLoopEnv {
  raf?: (cb: (now: number) => void) => number;
  caf?: (id: number) => void;
  now?: () => number;
}

export class FrameLoop {
  private rafId: number | null = null;
  private lastTime = 0;
  private needsRender = true;
  private hardPaused = false;
  private autoPaused = false;
  private destroyed = false;
  private readonly raf: (cb: (now: number) => void) => number;
  private readonly caf: (id: number) => void;
  private readonly now: () => number;

  constructor(private readonly hooks: FrameLoopHooks, env: FrameLoopEnv = {}) {
    this.raf = env.raf ?? ((cb) => requestAnimationFrame(cb));
    this.caf = env.caf ?? ((id) => cancelAnimationFrame(id));
    this.now = env.now ?? (() => performance.now());
  }

  /** Mark the scene dirty so the next frame redraws. While stopped (hard-paused or idle)
   *  this ALSO kicks a single on-demand frame, which then idles again. */
  requestRender = (): void => {
    this.needsRender = true;
    if (this.rafId === null && !this.destroyed) this.rafId = this.raf(this.tick);
  };

  /** Start (or resume) the continuous loop. No-op if already running or destroyed. */
  start(): void {
    if (this.rafId !== null || this.destroyed) return;
    this.lastTime = this.now();
    this.rafId = this.raf(this.tick);
  }

  /** Cancel any pending frame (does not clear the destroyed flag). */
  stop(): void {
    if (this.rafId !== null) {
      this.caf(this.rafId);
      this.rafId = null;
    }
  }

  private tick = (now: number): void => {
    // Clamp the real frame delta before it reaches the scheduler. A slow frame
    // (a pan hitch, GC pause, brief tab blur) would otherwise feed a larger dt →
    // the rate-scaled scheduler runs MORE catch-up ticks → an even slower frame:
    // the classic spiral. Capping at 50 ms bounds the 60 Hz movement burst to ≤3
    // ticks/frame at 1×, so the sim degrades to gentle slow-motion under load
    // instead of stuttering. Replay/determinism are unaffected (they drive the
    // scheduler directly with recorded ticks, never through this live path).
    const deltaMs = Math.min(now - this.lastTime, 50);
    this.lastTime = now;
    const animating = this.hooks.onFrame(now, deltaMs, this.hardPaused);
    if (animating || this.needsRender) {
      this.needsRender = false;
      this.hooks.onRender(deltaMs);
    }
    // Reschedule only while animating; otherwise stop and wait for requestRender — this is
    // what lets a hard pause / idle world fully idle the CPU + GPU.
    if (animating && !this.destroyed) this.rafId = this.raf(this.tick);
    else this.rafId = null;
  };

  /** Hard pause / resume — idles the loop + (via the hook) mutes audio and zeroes the sim
   *  rate. `auto` marks an automatic pause (tab hidden) so it auto-resumes; a manual pause
   *  does not. */
  setPaused(paused: boolean, opts: { auto?: boolean } = {}): void {
    if (paused === this.hardPaused) return;
    this.hardPaused = paused;
    this.autoPaused = paused ? !!opts.auto : false;
    this.hooks.onPauseChange(paused);
    if (paused) this.requestRender();  // draw the paused frame once, then idle
    else this.start();                 // resume the continuous loop
  }

  /** Toggle the hard pause (manual). */
  toggle(): void {
    this.setPaused(!this.hardPaused);
  }

  /** True while hard-paused (loop + audio suspended). */
  isPaused(): boolean {
    return this.hardPaused;
  }

  /** Tab-visibility hook: hidden → auto-pause to rest; visible → resume only if WE
   *  auto-paused it (never override a manual pause). */
  handleVisibility(hidden: boolean): void {
    if (hidden) {
      if (!this.hardPaused) this.setPaused(true, { auto: true });
    } else if (this.autoPaused) {
      this.setPaused(false);
    }
  }

  /** Permanently stop the loop (teardown). */
  destroy(): void {
    this.destroyed = true;
    this.stop();
  }
}
