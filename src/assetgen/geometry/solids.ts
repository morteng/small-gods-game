// src/assetgen/geometry/solids.ts
import type { Vec3, RGB, Mat, WorldFacet } from '@/assetgen/types';
import { MATERIAL_RGB } from '@/assetgen/types';
import type { Mesh } from 'manifold-3d';

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
const cross = (u: Vec3, v: Vec3): Vec3 =>
  [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]];
const norm = (v: Vec3): Vec3 => { const l = Math.hypot(v[0],v[1],v[2]) || 1; return [v[0]/l, v[1]/l, v[2]/l]; };
const shadeRGB = (c: RGB, f: number): RGB =>
  [Math.round(c[0]*f), Math.round(c[1]*f), Math.round(c[2]*f)];

/** Slope shade for the GREY reference: top brightest, +x brighter than +y, undersides dim. */
function brightness(n: Vec3): number {
  const u = norm(n);
  const k = u[0]*0.30 + u[1]*0.18 + u[2]*0.85;
  return Math.max(0.42, Math.min(1, 0.6 + 0.4 * k));
}

/** Convert a watertight manifold Mesh into flat-normal world facets, one per triangle. */
export function manifoldToFacets(mesh: Mesh, material: Mat): WorldFacet[] {
  const c = MATERIAL_RGB[material];
  const { numProp, vertProperties: vp, triVerts: tv } = mesh;
  const pos = (i: number): Vec3 => [vp[i*numProp], vp[i*numProp+1], vp[i*numProp+2]];
  const out: WorldFacet[] = [];
  for (let t = 0; t < tv.length; t += 3) {
    const a = pos(tv[t]), b = pos(tv[t+1]), d = pos(tv[t+2]);
    const n = cross(sub(b, a), sub(d, a));         // outward (manifold winding is CCW-outward)
    if (n[0] === 0 && n[1] === 0 && n[2] === 0) continue; // skip degenerate
    out.push({ pts: [a, b, d], normal: n, albedo: shadeRGB(c, brightness(n)) });
  }
  return out;
}
