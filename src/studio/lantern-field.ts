// src/studio/lantern-field.ts
// The LANTERNS ambient dial's effect field: warm glows at the building's baked lamp mount-sockets
// (`anchors.tags` entries whose `accepts` lists 'lamp' — see `tagScreenPoints` in studio.ts). In the
// SmokeField mould (ambient-dials.ts): dial-agnostic, wall-clock stepped, cosmetic-only (Math.random
// is fine here — the studio is a dev harness, not the deterministic sim).
//
// The glow's whole POINT is to react to darkness: a lit lantern is a faint daylight glint (you'd see
// the glass, not a light source) that blooms into a warm pool once the sun goes down. That envelope
// is `lanternAlpha(nightFactor)` — pure math, unit-tested — driven by the SAME `state.lighting.
// nightFactor` the studio already computes for window-glow, so scrubbing the time-of-day dial makes
// the lanterns breathe in step with the building's own lit windows.
//
// Dev-only (studio, tree-shaken from prod).

/** Glow envelope: how "on" a lantern looks at a given darkness level (0 = full day, 1 = deep
 *  night — same convention as `state.lighting.nightFactor`). A lit lantern is never fully invisible
 *  in daylight (a faint glint off the glass/metal) and never fully dark at night (it's LIT), so this
 *  ramps between a low day floor and a strong night ceiling rather than 0..1. Monotonic + clamped. */
export function lanternAlpha(nightFactor: number): number {
  const t = Math.max(0, Math.min(1, nightFactor));
  const DAY_FLOOR = 0.06;
  const NIGHT_CEIL = 0.85;
  // Smoothstep, not linear — the bloom should feel like it "catches" as dusk deepens rather than
  // fading in at a constant rate.
  const s = t * t * (3 - 2 * t);
  return DAY_FLOOR + (NIGHT_CEIL - DAY_FLOOR) * s;
}

/** Per-lamp flicker multiplier: a slow wall-clock sine (the "breathing" flame) plus a little
 *  Math.random jitter (the flame's restlessness), kept to a few percent so it reads as a living
 *  flame rather than a strobe. `seed` decorrelates lamps on the same building; `nowMs` is wall-clock
 *  so it's independent of frame dt (matches SmokeField's turbulence term). Returns a multiplier
 *  centred on 1, clamped to a tight band. */
export function lanternFlicker(nowMs: number, seed: number): number {
  const slow = Math.sin(nowMs * 0.003 + seed) * 0.05;                    // ±5% slow breathe
  const jitter = (Math.sin(nowMs * 0.037 + seed * 7.3) * 0.5) * 0.03;    // ±1.5% fast restlessness
  return Math.max(0.85, Math.min(1.15, 1 + slow + jitter));
}

interface LampPoint { x: number; y: number; kind: string; z: number }

const CORE_R = 2, CORE_R_JITTER = 0.5;      // bright core radius, px
const HALO_R = 18, HALO_R_JITTER = 4;       // halo radius, px
const CORE_RGB = '255,217,160';             // warm white (#ffd9a0)
const HALO_RGB = '255,150,60';              // warm orange

/** Warm lantern-glow field: `step()` latches the caller's current lamp points + darkness reading
 *  (points are recomputed fresh every frame by `tagScreenPoints`, so pan/zoom/re-roll track for
 *  free — nothing here owns world state); `draw()` paints a small bright core + a soft radial halo
 *  at each point, scaled by the darkness envelope. Per-lamp flicker seeds are keyed by screen
 *  position so a lamp keeps its own flicker phase frame to frame without needing a stable id. */
export class LanternField {
  private points: LampPoint[] = [];
  private tMs = 0;
  private nightFactor = 0;
  private seeds = new Map<string, number>();

  private seedFor(p: LampPoint): number {
    const key = `${Math.round(p.x)},${Math.round(p.y)}`;
    let s = this.seeds.get(key);
    if (s === undefined) { s = Math.random() * 1000; this.seeds.set(key, s); }
    return s;
  }

  /** Advance the wall clock + latch this frame's points/darkness. */
  step(points: LampPoint[], dtMs: number, nightFactor: number): void {
    this.points = points;
    this.tMs += Math.min(50, Math.max(0, dtMs));   // clamp like the game loop / SmokeField
    this.nightFactor = nightFactor;
  }

  /** Draw the glow field for the latched points. Call INSIDE the same camera transform the
   *  overlays/smoke use (world-screen space). */
  draw(ctx: CanvasRenderingContext2D): void {
    if (!this.points.length) return;
    const envelope = lanternAlpha(this.nightFactor);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';   // overlapping halos sum, not overwrite
    for (const p of this.points) {
      const seed = this.seedFor(p);
      const flick = lanternFlicker(this.tMs, seed);
      const a = Math.max(0, Math.min(1, envelope * flick));
      const haloR = HALO_R + Math.sin(seed) * HALO_R_JITTER;
      const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, haloR);
      grad.addColorStop(0, `rgba(${HALO_RGB},${(a * 0.55).toFixed(3)})`);
      grad.addColorStop(1, `rgba(${HALO_RGB},0)`);
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(p.x, p.y, haloR, 0, Math.PI * 2); ctx.fill();

      const coreR = CORE_R + Math.cos(seed) * CORE_R_JITTER;
      ctx.fillStyle = `rgba(${CORE_RGB},${a.toFixed(3)})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, coreR, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  /** Drop stale per-lamp seeds + latched points (e.g. subject swap) so a new building starts
   *  with fresh flicker instead of inheriting the old subject's phases. */
  clear(): void { this.points = []; this.seeds.clear(); }
}
