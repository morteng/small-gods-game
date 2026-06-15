/**
 * Lightweight runtime profiling — boot-phase timing + a rendered-frame FPS meter.
 *
 * Why this exists: boot had no `performance.mark`s, so the only way to time the
 * five loading phases was to monkey-patch `loadingScreen.setProgress` from the
 * outside (brittle, and impossible from a clean Playwright run). And absolute
 * FPS can't be read reliably under Playwright/CDP — it throttles the rAF loop —
 * so the trustworthy reading is an in-page HUD glanced at in a REAL browser.
 *
 * Both pieces are intentionally tiny and always-on-cheap: `bootMark()` is a
 * couple of timestamps, the FPS meter is a ring buffer. The HUD is the only
 * thing gated (it touches the DOM), shown via `?profile`/`?fps`, the backtick
 * key, or `window.__perf.showFps()`.
 */

// ── Boot phase timing ───────────────────────────────────────────────────────

interface BootStamp { label: string; t: number; }
let bootStamps: BootStamp[] = [];

const nowMs = (): number =>
  typeof performance !== 'undefined' && performance.now ? performance.now() : 0;

/**
 * Record a boot milestone. Call with `'start'` first to reset; each later call
 * names the phase that just COMPLETED before it (so the delta to the previous
 * mark is that phase's cost). Also emits a `performance.mark` for the devtools
 * timeline.
 */
export function bootMark(label: string): void {
  if (label === 'start') bootStamps = [];
  bootStamps.push({ label, t: nowMs() });
  try { performance.mark?.(`sg-boot:${label}`); } catch { /* no-op */ }
}

export interface BootPhase {
  /** The phase whose cost this row reports (the label passed to bootMark). */
  phase: string;
  /** Milliseconds spent in this phase (delta from the previous mark). */
  ms: number;
  /** Milliseconds since `'start'`. */
  sinceStartMs: number;
}

/** Per-phase boot timings derived from the recorded marks. Empty before boot. */
export function getBootProfile(): BootPhase[] {
  const out: BootPhase[] = [];
  for (let i = 1; i < bootStamps.length; i++) {
    out.push({
      phase: bootStamps[i].label,
      ms: +(bootStamps[i].t - bootStamps[i - 1].t).toFixed(1),
      sinceStartMs: +(bootStamps[i].t - bootStamps[0].t).toFixed(1),
    });
  }
  return out;
}

// ── Rendered-frame FPS meter ────────────────────────────────────────────────

const median = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

export interface FpsStats {
  /** Rendered frames in the sample window. */
  frames: number;
  /** Median inter-frame interval (ms). 0 if idle (no recent frames). */
  frameMs: number;
  /** Median frames per second derived from frameMs. */
  fps: number;
  /** Median render() duration (ms) — the work, separate from vsync wait. */
  renderMs: number;
  /** 95th-percentile render duration (ms) — the hitch indicator. */
  renderP95Ms: number;
  /** True when no frame has been recorded recently (paused / idle). */
  idle: boolean;
}

/**
 * Ring-buffer FPS meter fed from the frame loop. `frame()` is called ONCE per
 * actually-rendered frame (render-on-demand means idle frames aren't counted),
 * with the measured render() duration. Cheap enough to always run.
 */
export class FpsMeter {
  private readonly cap: number;
  private readonly intervals: number[] = [];
  private readonly renders: number[] = [];
  private last = 0;

  constructor(cap = 90) { this.cap = cap; }

  /** Record a rendered frame; `renderMs` is the cost of the draw call itself. */
  frame(renderMs: number): void {
    const now = nowMs();
    if (this.last) {
      const dt = now - this.last;
      // A gap > 500ms means we were idle (paused, no renders) — don't pollute
      // the cadence stats with the resume interval.
      if (dt < 500) {
        this.intervals.push(dt);
        if (this.intervals.length > this.cap) this.intervals.shift();
      } else {
        this.intervals.length = 0;
      }
    }
    this.last = now;
    this.renders.push(renderMs);
    if (this.renders.length > this.cap) this.renders.shift();
  }

  stats(): FpsStats {
    const idle = this.last === 0 || nowMs() - this.last > 500;
    const frameMs = idle ? 0 : median(this.intervals);
    const sortedR = [...this.renders].sort((a, b) => a - b);
    const p95 = sortedR.length ? sortedR[Math.floor(sortedR.length * 0.95)] : 0;
    return {
      frames: this.intervals.length,
      frameMs: +frameMs.toFixed(2),
      fps: frameMs > 0 ? +(1000 / frameMs).toFixed(1) : 0,
      renderMs: +median(this.renders).toFixed(2),
      renderP95Ms: +p95.toFixed(2),
      idle,
    };
  }

  reset(): void {
    this.intervals.length = 0;
    this.renders.length = 0;
    this.last = 0;
  }
}
