// src/render/gpu/adaptive-resolution.ts
//
// P-E — adaptive art-pixel resolution. The scene renders into a low-res target
// (`gpu-scene` blit); this controller picks the art-pixel size from a smoothed
// frame time. Default policy: render 1:1 (px=1, crispest) and coarsen step-by-
// step up the [1,2,3,4] ladder to HOLD ≈30 fps — each coarser level cuts the
// fragment cost ~quadratically — restoring finer levels once it recovers margin.
//
// Pure logic — no DOM, no GPU, no `performance.now()` — so the hysteresis is
// unit-testable by feeding synthetic frame deltas. The caller measures the delta.

export interface AdaptiveResolutionOpts {
  /** Art-pixel ladder, ascending (finer → coarser). Default [1, 2, 3, 4]. */
  levels?: number[];
  /** Smoothed frame-time (ms) above which to coarsen. Default 33.3 (≈30 fps). */
  downMs?: number;
  /** Smoothed frame-time (ms) below which to refine. Default 20 (≈50 fps). */
  upMs?: number;
  /** Sustained frames over `downMs` before coarsening. Default 20. */
  downFrames?: number;
  /** Sustained frames under `upMs` before refining. Default 90. */
  upFrames?: number;
  /** EMA smoothing factor for the frame time. Default 0.1. */
  emaAlpha?: number;
  /** Ignore single spikes above this (tab-stall, GC). Default 100 ms. */
  clampMs?: number;
}

/**
 * Hysteretic frame-time → art-pixel-level controller. Coarsens (fewer pixels)
 * only after the rate stays low for `downFrames`, and refines back only after it
 * stays high for `upFrames` — the asymmetric thresholds + frame counts prevent
 * flapping around the boundary. On any level change the EMA is reset to the
 * neutral midpoint so the next decision starts from a clean slate.
 */
export class AdaptiveResolution {
  private readonly levels: number[];
  private readonly downMs: number;
  private readonly upMs: number;
  private readonly downFrames: number;
  private readonly upFrames: number;
  private readonly alpha: number;
  private readonly clampMs: number;
  private readonly neutral: number;
  private ema: number;
  private idx = 0;
  private over = 0;
  private under = 0;

  constructor(opts: AdaptiveResolutionOpts = {}) {
    this.levels = opts.levels && opts.levels.length > 0 ? opts.levels.slice() : [1, 2, 3, 4];
    this.downMs = opts.downMs ?? 1000 / 30;
    this.upMs = opts.upMs ?? 20;
    this.downFrames = opts.downFrames ?? 20;
    this.upFrames = opts.upFrames ?? 90;
    this.alpha = opts.emaAlpha ?? 0.1;
    this.clampMs = opts.clampMs ?? 100;
    this.neutral = (this.downMs + this.upMs) / 2;
    this.ema = this.upMs; // optimistic: start at the finest level
  }

  /** The current art-pixel size. */
  get px(): number { return this.levels[this.idx]; }

  /** Feed one frame delta (ms); returns the (possibly changed) art-pixel size. */
  step(dtMs: number): number {
    const dt = Math.min(Math.max(dtMs, 0), this.clampMs);
    this.ema = this.ema * (1 - this.alpha) + dt * this.alpha;

    if (this.ema > this.downMs) { this.over++; this.under = 0; }
    else if (this.ema < this.upMs) { this.under++; this.over = 0; }
    else { this.over = 0; this.under = 0; }

    if (this.over >= this.downFrames && this.idx < this.levels.length - 1) {
      this.idx++;
      this.over = 0;
      this.ema = this.neutral;
    } else if (this.under >= this.upFrames && this.idx > 0) {
      this.idx--;
      this.under = 0;
      this.ema = this.neutral;
    }
    return this.px;
  }
}
