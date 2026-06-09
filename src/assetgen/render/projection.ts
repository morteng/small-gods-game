// src/assetgen/render/projection.ts
import type { Vec3, Pt, RGB, WorldFacet, ScreenFacet } from '@/assetgen/types';

const len = (v: Vec3): number => Math.hypot(v[0], v[1], v[2]) || 1;
export const normalize = (v: Vec3): Vec3 => { const l = len(v); return [v[0]/l, v[1]/l, v[2]/l]; };
export const dot = (a: Vec3, b: Vec3): number => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];

/** 2:1 dimetric screen basis (camera at (1,1,1)): R=screen-right, DOWN=screen-y, VIEW=toward-camera. */
export const RIGHT: Vec3 = [0.7071, -0.7071, 0];
export const DOWN:  Vec3 = [0.4082, 0.4082, -0.8165];
export const VIEW:  Vec3 = [0.5774, 0.5774, 0.5774];

/** Pack a world normal into a screen-space normal-map RGB (R=right, G=up=-screen-y, B=toward-cam). */
export function normalRGB(n: Vec3): RGB {
  const u = normalize(n);
  const sx = dot(u, RIGHT), sy = dot(u, DOWN), sz = dot(u, VIEW);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round((v*0.5+0.5)*255)));
  return [c(sx), c(-sy), c(sz)];
}

/** A facet is visible iff its outward normal faces the camera. */
export const frontFacing = (n: Vec3): boolean => dot(normalize(n), VIEW) > 1e-3;

export interface ProjScale { scale: number; ox: number; oy: number }

/** World (tile x,y; z up) → screen pixel under the 2:1 dimetric view. */
export function project(p: Vec3, s: ProjScale): Pt {
  return {
    x: (p[0] - p[1]) * s.scale + s.ox,
    y: (p[0] + p[1]) * (s.scale * 0.5) - p[2] * s.scale + s.oy,
  };
}

/** Depth along the view axis; larger = nearer the camera. */
export const viewDepth = (p: Vec3): number => dot(p, VIEW);

/** Project + back-face-cull + key each facet by mean view-depth. */
export function projectFacets(facets: WorldFacet[], s: ProjScale): ScreenFacet[] {
  const out: ScreenFacet[] = [];
  for (const f of facets) {
    if (!frontFacing(f.normal)) continue;
    const pts = f.pts.map(p => project(p, s));
    const depths = f.pts.map(viewDepth);
    const depth = depths.reduce((a, d) => a + d, 0) / depths.length;
    out.push({ pts, normal: f.normal, albedo: f.albedo, depth, depths, mat: f.mat });
  }
  return out;
}
