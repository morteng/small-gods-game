// src/assetgen/geometry/primitives.ts
import type { Vec2, Vec3, RGB, Mat, WorldFacet } from '@/assetgen/types';
import { MATERIAL_RGB } from '@/assetgen/types';

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
