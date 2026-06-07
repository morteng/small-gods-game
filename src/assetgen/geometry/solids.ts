// src/assetgen/geometry/solids.ts
import type { Vec3, RGB, Mat, WorldFacet } from '@/assetgen/types';
import { MATERIAL_RGB } from '@/assetgen/types';
import type { Mesh, Manifold } from 'manifold-3d';
import type { Vec2 } from '@/assetgen/types';
import { getManifold } from '@/assetgen/geometry/manifold-runtime';
import { STOREY, type Wing, type RoofStyle } from '@/assetgen/geometry/building';

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

// ---------------------------------------------------------------------------
// Primitive solid builders
// ---------------------------------------------------------------------------

/** Axis-aligned box: min corner `at`, extent `size`. */
export async function solidBox(at: Vec3, size: Vec3): Promise<Manifold> {
  const { Manifold } = await getManifold();
  return Manifold.cube(size).translate(at);
}

/** Vertical cylinder, base centred at (cx,cy,baseZ). */
export async function solidCylinder(center: Vec2, baseZ: number, radius: number, height: number): Promise<Manifold> {
  const { Manifold } = await getManifold();
  return Manifold.cylinder(height, radius, radius).translate([center[0], center[1], baseZ]);
}

/** Cone/frustum, base centred at (cx,cy,baseZ); radiusBase at bottom → radiusTop at top. */
export async function solidCone(center: Vec2, baseZ: number, radiusTop: number, radiusBase: number, height: number): Promise<Manifold> {
  const { Manifold } = await getManifold();
  return Manifold.cylinder(height, radiusBase, radiusTop).translate([center[0], center[1], baseZ]);
}

/** Regular n-gon prism (n sides), base centred at (cx,cy,baseZ). */
export async function solidPrism(center: Vec2, baseZ: number, radius: number, height: number, sides: number): Promise<Manifold> {
  const { Manifold } = await getManifold();
  return Manifold.cylinder(height, radius, radius, sides).translate([center[0], center[1], baseZ]);
}

/** Ellipsoid centred at (cx,cy,baseZ+rz), radii [rx,ry,rz]. */
export async function solidEllipsoid(center: Vec2, baseZ: number, radii: Vec3): Promise<Manifold> {
  const { Manifold } = await getManifold();
  return Manifold.sphere(1).scale(radii).translate([center[0], center[1], baseZ + radii[2]]);
}

/** Post-and-lintel arch (two uprights + a spanning beam) as one unioned solid, spanning +x. */
export async function solidArch(at: Vec3, span: number, height: number, thickness: number): Promise<Manifold> {
  const { Manifold } = await getManifold();
  const t = thickness;
  const left  = Manifold.cube([t, t, height]).translate([at[0], at[1], at[2]]);
  const right = Manifold.cube([t, t, height]).translate([at[0] + span - t, at[1], at[2]]);
  const beam  = Manifold.cube([span, t, t]).translate([at[0], at[1], at[2] + height]);
  return Manifold.union([left, right, beam]);
}

// ---------------------------------------------------------------------------
// Building massing — walls + roof as two unioned solids
// ---------------------------------------------------------------------------

const GABLE_PITCH = 1.5, HIP_PITCH = 1.35;

/**
 * A gable-roof prism over one wing rect, ridge along the given world axis, sitting on
 * the wall top. The 2D profile (span across, rise up) is extruded +Z by the ridge length,
 * then rotated/translated so its footprint lands exactly on the wing rect. Euler angles +
 * translates were tuned empirically from the prism bbox (see assetgen-solids tests).
 */
async function wingGablePrism(w: Wing, ridgeAxis: 'x' | 'y', pitch: number): Promise<Manifold> {
  const { Manifold } = await getManifold();
  const b = (w.storeys ?? 1) * STOREY;
  if (ridgeAxis === 'x') {
    // span = w.h, ridge length = w.w. extrude→rotate[90,0,90] lands footprint at origin
    // sized [w.w,w.h] with rise in +Z; translate onto the wing at the wall top.
    const rise = pitch * (w.h / 2);
    const profile = [[0, 0], [w.h, 0], [w.h / 2, rise]] as [number, number][];
    return Manifold.extrude(profile, w.w)
      .rotate([90, 0, 90])
      .translate([w.x, w.y, b]);
  } else {
    // span = w.w, ridge length = w.h. rotate[90,0,0] puts ridge along −Y; translate by
    // +w.h brings it to [w.y, w.y+w.h]; span sits in +X, rise in +Z.
    const rise = pitch * (w.w / 2);
    const profile = [[0, 0], [w.w, 0], [w.w / 2, rise]] as [number, number][];
    return Manifold.extrude(profile, w.h)
      .rotate([90, 0, 0])
      .translate([w.x, w.y + w.h, b]);
  }
}

/** One wing's roof solid: gable (single prism) or hip (two perpendicular prisms intersected). */
async function wingRoof(w: Wing, style: RoofStyle): Promise<Manifold> {
  const longAxis: 'x' | 'y' = w.w >= w.h ? 'x' : 'y';
  if (style === 'gable') return wingGablePrism(w, longAxis, GABLE_PITCH);
  const px = await wingGablePrism(w, 'x', HIP_PITCH);
  const py = await wingGablePrism(w, 'y', HIP_PITCH);
  return px.intersect(py);
}

/**
 * Full building massing as flat-normal facets. Walls + roof are two separate unioned solids
 * (disjoint in z), each its own material. Crossed roof prisms union into correct hips/valleys
 * by construction — replaces the hand-rolled height field (kills the roof-valley stripe).
 */
export async function buildingFacets(
  wings: Wing[], wallMat: Mat = 'plaster', roofMat: Mat = 'tile', roofStyle: RoofStyle = 'gable',
): Promise<WorldFacet[]> {
  const { Manifold } = await getManifold();
  const wallSolids = await Promise.all(
    wings.map(w => solidBox([w.x, w.y, 0], [w.w, w.h, (w.storeys ?? 1) * STOREY])),
  );
  const roofSolids = await Promise.all(wings.map(w => wingRoof(w, roofStyle)));
  const walls = Manifold.union(wallSolids);
  const roof = Manifold.union(roofSolids);
  return [
    ...manifoldToFacets(walls.getMesh(), wallMat),
    ...manifoldToFacets(roof.getMesh(), roofMat),
  ];
}
