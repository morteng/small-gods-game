// src/core/math.ts
//
// The one home for the tiny scalar math helpers that were copy-pasted across ~25
// modules (clamp01 ×14, lerp ×7, clamp ×5, smoothstep ×4). Pure, allocation-free,
// no `Math.random` (safe to import from `src/sim/`, which the determinism guard
// keeps random-free). Behaviour matches the prior local copies exactly, including
// the NaN pass-through of the `Math.max/min` form.

/** Clamp to the unit interval [0, 1]. */
export function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/** Clamp `v` into [lo, hi]. */
export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Linear interpolation between `a` and `b` by `t` (unclamped). */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Hermite smoothstep over the [edge0, edge1] band → 0..1 (clamped). */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** Hermite smoothstep of an already-normalised `t` in [0, 1]. */
export function smoothstep01(t: number): number {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
}
