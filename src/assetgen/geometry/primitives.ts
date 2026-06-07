// src/assetgen/geometry/primitives.ts
import type { Vec2, Vec3, RGB, Mat, WorldFacet } from '@/assetgen/types';
import { MATERIAL_RGB } from '@/assetgen/types';
import { normalize } from '@/assetgen/render/projection';

const shade = (c: RGB, f: number): RGB => [Math.round(c[0]*f), Math.round(c[1]*f), Math.round(c[2]*f)];
// Per-face shading so the grey reference reads as 3-D form (carried from the spike).
const TOP = 1.0, FACE_X = 0.82, FACE_Y = 0.62;

/** Axis-aligned box. `at` = min (x,y) corner at base; z = base height; `size` = [sx,sy,sz]. */
export function box(at: Vec3, size: Vec3, material: Mat = 'stone'): WorldFacet[] {
  const c = MATERIAL_RGB[material];
  const [x0, y0, z0] = at, x1 = x0+size[0], y1 = y0+size[1], z1 = z0+size[2];
  return [
    { pts: [[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]], normal: [0,0,1], albedo: shade(c, TOP) },    // top +z
    { pts: [[x1,y0,z0],[x1,y1,z0],[x1,y1,z1],[x1,y0,z1]], normal: [1,0,0], albedo: shade(c, FACE_X) },  // +x wall
    { pts: [[x0,y1,z0],[x1,y1,z0],[x1,y1,z1],[x0,y1,z1]], normal: [0,1,0], albedo: shade(c, FACE_Y) },  // +y wall
  ];
}

/** Regular n-gon extruded from base radius r0 to top radius r1 (cone if r1=0), centred at (cx,cy). */
export function extrudeNgon(
  center: Vec2, baseZ: number, r0: number, r1: number, height: number, sides: number,
  material: Mat = 'stone', rot = 0,
): WorldFacet[] {
  const c = MATERIAL_RGB[material];
  const [cx, cy] = center, zt = baseZ + height;
  const ring = (r: number, z: number): Vec3[] => Array.from({ length: sides }, (_, k) => {
    const a = rot + (k / sides) * Math.PI * 2;
    return [cx + Math.cos(a)*r, cy + Math.sin(a)*r, z] as Vec3;
  });
  const lo = ring(r0, baseZ), hi = ring(r1, zt);
  const tilt = (r0 - r1) / (height || 1);
  const out: WorldFacet[] = [];
  for (let k = 0; k < sides; k++) {
    const n = (k + 1) % sides;
    const mid = rot + ((k + 0.5) / sides) * Math.PI * 2;
    const nrm: Vec3 = [Math.cos(mid), Math.sin(mid), tilt];
    const f = 0.6 + 0.22 * ((Math.cos(mid)*0.7071 + Math.sin(mid)*0.7071) + 1) / 2;
    if (r1 === 0) out.push({ pts: [lo[k], lo[n], hi[k]], normal: nrm, albedo: shade(c, f) }); // cone tri (hi[k]=apex)
    else out.push({ pts: [lo[k], lo[n], hi[n], hi[k]], normal: nrm, albedo: shade(c, f) });   // side quad
  }
  if (r1 > 0) out.push({ pts: hi, normal: [0,0,1], albedo: shade(c, TOP) }); // top cap
  return out;
}

export const cylinder = (center: Vec2, baseZ: number, radius: number, height: number, material: Mat = 'stone', sides = 18): WorldFacet[] =>
  extrudeNgon(center, baseZ, radius, radius, height, sides, material);
export const prism = (center: Vec2, baseZ: number, radius: number, height: number, sides: number, material: Mat = 'stone', rot = 0): WorldFacet[] =>
  extrudeNgon(center, baseZ, radius, radius, height, sides, material, rot);
export const cone = (center: Vec2, baseZ: number, radius: number, height: number, material: Mat = 'foliage', sides = 18): WorldFacet[] =>
  extrudeNgon(center, baseZ, radius, 0, height, sides, material);

/** Ellipsoid centred at (cx, cy, baseZ+rz), radii [rx,ry,rz]; lat/long tessellation. */
export function ellipsoid(center: Vec2, baseZ: number, radii: Vec3, material: Mat = 'foliage', segU = 12, segV = 8): WorldFacet[] {
  const c = MATERIAL_RGB[material];
  const [cx, cy] = center, [rx, ry, rz] = radii, cz = baseZ + rz;
  const P = (u: number, v: number): Vec3 => {
    const th = u * Math.PI * 2, ph = v * Math.PI - Math.PI / 2;
    return [cx + Math.cos(ph)*Math.cos(th)*rx, cy + Math.cos(ph)*Math.sin(th)*ry, cz + Math.sin(ph)*rz];
  };
  const norm = (p: Vec3): Vec3 => [(p[0]-cx)/(rx*rx), (p[1]-cy)/(ry*ry), (p[2]-cz)/(rz*rz)];
  const out: WorldFacet[] = [];
  for (let i = 0; i < segU; i++) for (let j = 0; j < segV; j++) {
    const a = P(i/segU, j/segV), b = P((i+1)/segU, j/segV), e = P((i+1)/segU, (j+1)/segV), d = P(i/segU, (j+1)/segV);
    const nrm = norm([(a[0]+e[0])/2, (a[1]+e[1])/2, (a[2]+e[2])/2]);
    const up = (normalize(nrm)[2] + 1) / 2;
    out.push({ pts: [a, b, e, d], normal: nrm, albedo: shade(c, 0.7 + 0.3*up) });
  }
  return out;
}

/** Post-and-lintel arch (gate / trilithon): two uprights + a top beam spanning +x. */
export function arch(at: Vec3, span: number, height: number, thickness: number, material: Mat = 'stone'): WorldFacet[] {
  const [x, y, z] = at, t = thickness;
  return [
    ...box([x, y, z], [t, t, height], material),               // left post
    ...box([x + span - t, y, z], [t, t, height], material),    // right post
    ...box([x, y, z + height], [span, t, t], material),        // lintel
  ];
}
