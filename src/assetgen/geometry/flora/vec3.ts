// src/assetgen/geometry/flora/vec3.ts
// Minimal Vec3 helpers for the flora geometry kit. Pure, dependency-free,
// Node+browser. The turtle works in an orthonormal {H,L,U} frame; these are the
// operations it needs (rotate-about-axis via Rodrigues) plus the perpendicular
// ring frame the tube mesher uses to extrude limbs.
import type { Vec3 } from '@/assetgen/types';

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 =>
  [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
export const normalize = (a: Vec3): Vec3 => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** Rotate vector `v` about unit axis `k` by `angle` radians (Rodrigues' formula). */
export function rotateAbout(v: Vec3, k: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle), s = Math.sin(angle);
  const kv = cross(k, v);
  const kk = dot(k, v) * (1 - c);
  return [
    v[0] * c + kv[0] * s + k[0] * kk,
    v[1] * c + kv[1] * s + k[1] * kk,
    v[2] * c + kv[2] * s + k[2] * kk,
  ];
}

/** Two unit vectors perpendicular to `dir` (and to each other), for ring extrusion.
 *  Stable: picks the world axis least aligned with `dir` to seed the cross product. */
export function perpFrame(dir: Vec3): [Vec3, Vec3] {
  const d = normalize(dir);
  const seed: Vec3 = Math.abs(d[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const u = normalize(cross(d, seed));
  const w = normalize(cross(d, u));
  return [u, w];
}
