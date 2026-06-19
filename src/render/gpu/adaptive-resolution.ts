// src/render/gpu/adaptive-resolution.ts
//
// P-E — adaptive art-pixel resolution. The scene renders into a low-res target
// (`gpu-scene` blit); this controller picks the art-pixel size from a smoothed
// frame time.
//
// POLICY: strive for the HIGHEST resolution that holds the 30 fps target. Render
// 1:1 (px=1, crispest) by default; coarsen one step up the [1,2,3,4] ladder only
// when the smoothed rate sags below 30 fps (each coarser level cuts the fragment
// cost ~quadratically); and refine back toward 1:1 as soon as there is comfortable
// headroom (≥40 fps). Resolution is a responsiveness fallback, NOT a quality knob —
// any spare frame budget is spent on more pixels.
//
// Two earlier failure modes this version fixes:
//   1. DEAD ZONE — the refine threshold sat at 50 fps and the coarsen threshold at
//      30 fps, so a machine cruising at 30–50 fps (above target, with headroom)
//      fell in a band where neither counter advanced and it stuck at the coarsest
//      level forever. The band is now 30→40 fps and the in-band rule HOLDS rather
//      than resetting progress.
//   2. SPIKE FRAGILITY — a single slow frame (GC, a zoom-time instance repack) hard-
//      reset the "frames of headroom" counter, so the 60-frame climb-back almost
//      never completed under real jitter. Counters now BLEED (decrement) on an off-
//      side frame instead of zeroing, and a clamped stall (tab-switch) is ignored
//      outright, so transient drops can't erase hard-won refine progress.
//
// Pure logic — no DOM, no GPU, no `performance.now()` — so the hysteresis is
// unit-testable by feeding synthetic frame deltas. The caller measures the delta.

export interface AdaptiveResolutionOpts {
  /** Art-pixel ladder, ascending (finer → coarser). Default [1, 2, 3, 4]. */
  levels?: number[];
  /** Smoothed frame-time (ms) above which to coarsen. Default 33.3 (≈30 fps). */
  downMs?: number;
  /** Smoothed frame-time (ms) below which to refine. Default 25 (≈40 fps). */
  upMs?: number;
  /** Sustained frames over `downMs` before coarsening. Default 20. */
  downFrames?: number;
  /** Sustained frames under `upMs` before refining. Default 60. */
  upFrames?: number;
  /** EMA smoothing factor for the frame time. Default 0.1. */
  emaAlpha?: number;
  /** Ignore single spikes at/above this (tab-stall, GC) entirely. Default 100 ms. */
  clampMs?: number;
  /** After a refine is undone (coarsen soon after), suppress refining for this many
   *  frames so we settle at the highest sustainable level instead of flapping.
   *  Default 240 (~4 s @ 60 fps). */
  flapCooldownFrames?: number;
  /** A coarsen within this many frames of the last refine counts as "undoing" it.
   *  Default 90. */
  flapWindowFrames?: number;
}

/**
 * Hysteretic frame-time → art-pixel-level controller. Coarsens (fewer pixels)
 * after the rate stays below 30 fps for `downFrames`, and refines back (more
 * pixels) after it stays above 40 fps for `upFrames`. The asymmetric thresholds
 * give a 30–40 fps hold band; the counters bleed rather than reset so a stray slow
 * frame can't undo climb progress; and a flap-guard stops it from oscillating into
 * a finer level the machine can't actually hold. On a level change the EMA resets
 * to the band midpoint so the next decision starts clean.
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
  private readonly flapCooldownFrames: number;
  private readonly flapWindowFrames: number;
  private ema: number;
  private idx = 0;
  private over = 0;
  private under = 0;
  private framesSinceRefine = Infinity; // ∞ ⇒ no refine yet to undo
  private refineCooldown = 0;           // >0 ⇒ refining is suppressed (anti-flap)

  constructor(opts: AdaptiveResolutionOpts = {}) {
    this.levels = opts.levels && opts.levels.length > 0 ? opts.levels.slice() : [1, 2, 3, 4];
    this.downMs = opts.downMs ?? 1000 / 30;
    this.upMs = opts.upMs ?? 1000 / 40;
    this.downFrames = opts.downFrames ?? 20;
    this.upFrames = opts.upFrames ?? 60;
    this.alpha = opts.emaAlpha ?? 0.1;
    this.clampMs = opts.clampMs ?? 100;
    this.flapCooldownFrames = opts.flapCooldownFrames ?? 240;
    this.flapWindowFrames = opts.flapWindowFrames ?? 90;
    this.neutral = (this.downMs + this.upMs) / 2;
    this.ema = this.upMs; // optimistic: start at the finest level
  }

  /** The current art-pixel size. */
  get px(): number { return this.levels[this.idx]; }

  /** Feed one frame delta (ms); returns the (possibly changed) art-pixel size. */
  step(dtMs: number): number {
    // A giant stall (tab switch, alt-tab, a GC pause) says nothing about steady
    // rendering cost — ignore it outright so it can't bump the EMA or bleed away
    // hard-won refine progress.
    if (dtMs >= this.clampMs) return this.px;

    const dt = Math.max(dtMs, 0);
    this.ema = this.ema * (1 - this.alpha) + dt * this.alpha;
    if (this.framesSinceRefine < Number.MAX_SAFE_INTEGER) this.framesSinceRefine++;
    if (this.refineCooldown > 0) this.refineCooldown--;

    if (this.ema > this.downMs) {
      // Slower than 30 fps → build coarsen pressure, bleed off refine progress. A
      // sustained slowdown both maxes `over` AND drains `under`; a brief dip only
      // nicks it.
      this.over++;
      this.under = Math.max(0, this.under - 2);
    } else if (this.ema < this.upMs) {
      // Comfortable headroom (≥40 fps) → build refine pressure, bleed off coarsen.
      this.under++;
      this.over = Math.max(0, this.over - 2);
    } else {
      // In the 30–40 fps hold band → keep this level; let both pressures decay
      // slowly so a brief excursion through the band doesn't erase progress (this
      // is what used to pin it at the coarsest level).
      this.over = Math.max(0, this.over - 1);
      this.under = Math.max(0, this.under - 1);
    }

    if (this.over >= this.downFrames && this.idx < this.levels.length - 1) {
      // If we're coarsening soon after a refine, that refine "failed" — suppress
      // refining for a cooldown so we settle here instead of flapping.
      if (this.framesSinceRefine < this.flapWindowFrames) {
        this.refineCooldown = this.flapCooldownFrames;
      }
      this.idx++;
      this.over = 0;
      this.under = 0;
      this.ema = this.neutral;
    } else if (
      this.under >= this.upFrames &&
      this.idx > 0 &&
      this.refineCooldown <= 0
    ) {
      this.idx--;
      this.over = 0;
      this.under = 0;
      this.framesSinceRefine = 0;
      this.ema = this.neutral;
    }
    return this.px;
  }
}
