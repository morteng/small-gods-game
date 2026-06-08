// src/assetgen/geometry/solids.ts
import type { Vec3, RGB, Mat, WorldFacet } from '@/assetgen/types';
import { MATERIAL_RGB } from '@/assetgen/types';
import type { Mesh, Manifold } from 'manifold-3d';
import type { Vec2 } from '@/assetgen/types';
import { getManifold } from '@/assetgen/geometry/manifold-runtime';
import {
  STOREY, type Wing, type RoofKind, type RoofStyle, type RidgeAxis,
  type BuildingFeatures, type BuildingAnchors, type VentFeature, type VentKind, type WallFace,
  ridgeAxisOf, resolveFeatures,
} from '@/assetgen/geometry/building';

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

/** Absolute box to subtract from a wall solid (an opening's aperture). */
export interface ApertureBox { at: Vec3; size: Vec3 }

/** Subtract a set of aperture boxes from a wall solid (carving openings). No-op if empty. */
export async function carveApertures(solid: Manifold, apertures: ApertureBox[] = []): Promise<Manifold> {
  if (!apertures.length) return solid;
  const { Manifold } = await getManifold();
  const holes = await Promise.all(apertures.map(a => solidBox(a.at, a.size)));
  return solid.subtract(Manifold.union(holes));
}

/** Bore a round vertical well of `depth` straight down from `topZ` at `center`, radius `radius`.
 *  Used for round roof oculi (the yurt's open toono). Pokes slightly past `topZ` for a clean lip. */
export async function boreCylinder(solid: Manifold, center: Vec2, topZ: number, radius: number, depth: number): Promise<Manifold> {
  const eps = 0.1;
  const cutter = await solidCylinder(center, topZ - depth, radius, depth + eps);
  return solid.subtract(cutter);
}

// ---------------------------------------------------------------------------
// Building massing — walls + roof as two unioned solids
// ---------------------------------------------------------------------------

const GABLE_PITCH = 1.5, HIP_PITCH = 1.35;

/** Roof style a wing actually uses: per-wing override (`flat`/`pyramidal` collapse to
 *  the two prism styles) else the building-wide style. */
function wingRoofStyle(w: Wing, style: RoofStyle): RoofStyle {
  const k: RoofKind | undefined = w.roof;
  if (k === 'gable') return 'gable';
  if (k === 'hip' || k === 'pyramidal') return 'hip';
  return style;                                  // 'flat' → handled separately; else inherit
}

/** Cross-span (the dimension perpendicular to the ridge) of a wing rect. */
function crossSpan(rect: WingRect, ridge: RidgeAxis): number {
  return ridge === 'x' ? rect.h : rect.w;
}

/** A wing rect possibly grown by jetty for an upper storey. */
interface WingRect { x: number; y: number; w: number; h: number }

/** The footprint of storey `s` (0 = ground): the base rect grown by `jetty*s` toward the
 *  camera (+x/+y) — the oversailing jettied upper floor. */
function storeyRect(w: Wing, s: number): WingRect {
  const j = (w.jetty ?? 0) * s;
  return { x: w.x, y: w.y, w: w.w + j, h: w.h + j };
}

/**
 * A gable-roof prism over a wing rect, ridge along the given world axis, sitting at base z `b`.
 * The 2D profile (span across, rise up) is extruded by the ridge length, then rotated/translated
 * so its footprint lands on the rect. Euler angles were tuned empirically (see solids tests).
 */
async function gablePrism(rect: WingRect, ridge: RidgeAxis, pitch: number, b: number): Promise<Manifold> {
  const { Manifold } = await getManifold();
  if (ridge === 'x') {
    const rise = pitch * (rect.h / 2);
    const profile = [[0, 0], [rect.h, 0], [rect.h / 2, rise]] as [number, number][];
    return Manifold.extrude(profile, rect.w).rotate([90, 0, 90]).translate([rect.x, rect.y, b]);
  }
  const rise = pitch * (rect.w / 2);
  const profile = [[0, 0], [rect.w, 0], [rect.w / 2, rise]] as [number, number][];
  return Manifold.extrude(profile, rect.h).rotate([90, 0, 0]).translate([rect.x, rect.y + rect.h, b]);
}

/** One wing's roof solid over its (possibly jettied) top rect. gable = one prism along the
 *  ridge axis; hip = two perpendicular prisms intersected; flat = a thin slab. */
async function wingRoof(w: Wing, style: RoofStyle): Promise<Manifold> {
  const top = storeyRect(w, (w.storeys ?? 1) - 1);
  const b = (w.storeys ?? 1) * STOREY;
  if (w.roof === 'flat') return solidBox([top.x, top.y, b], [top.w, top.h, 0.25]);
  const s = wingRoofStyle(w, style);
  if (s === 'gable') return gablePrism(top, ridgeAxisOf(w), GABLE_PITCH, b);
  const px = await gablePrism(top, 'x', HIP_PITCH, b);
  const py = await gablePrism(top, 'y', HIP_PITCH, b);
  return px.intersect(py);
}

/** Height the roof ridge reaches above a wing's wall top. */
function roofRise(w: Wing, style: RoofStyle): number {
  if (w.roof === 'flat') return 0.25;
  const top = storeyRect(w, (w.storeys ?? 1) - 1);
  const s = wingRoofStyle(w, style);
  const pitch = s === 'gable' ? GABLE_PITCH : HIP_PITCH;
  return pitch * (crossSpan(top, ridgeAxisOf(w)) / 2);
}

// ── attachable feature solids (own material, sit proud so the z-buffer shows them) ──

/** The width-units thickness + above-ridge protrusion + material for each vent kind. */
function ventProfile(kind: VentKind, v: VentFeature): { cw: number; protrude: number; mat: Mat } {
  switch (kind) {
    case 'pipe':      return { cw: v.width ?? 0.16, protrude: v.height ?? 0.9, mat: 'metal' };
    case 'smokehole': return { cw: v.width ?? 0.30, protrude: v.height ?? 0.15, mat: 'stone' };
    case 'chimney':   return { cw: v.width ?? 0.42, protrude: v.height ?? 0.7, mat: 'brick' };
  }
}

/**
 * A smoke vent as its own solid + top anchor (the emission point).
 *  - ridge: a stack rising from the roof slope, clearing the ridge.
 *  - wall: an exterior stack climbing a chosen wall from the ground, clearing the ridge.
 */
async function ventSolid(
  w: Wing, v: VentFeature, style: RoofStyle,
): Promise<{ solid: Manifold; anchor: [number, number, number]; mat: Mat }> {
  const wallTop = (w.storeys ?? 1) * STOREY;
  const rise = roofRise(w, style);
  const top = storeyRect(w, (w.storeys ?? 1) - 1);
  const kind: VentKind = v.kind ?? 'chimney';
  const { cw, protrude, mat } = ventProfile(kind, v);
  const topZ = wallTop + rise + protrude;

  if ((v.placement ?? 'ridge') === 'wall') {
    // Exterior stack hugging a wall, from the ground up past the ridge.
    const face: WallFace = v.face ?? 'south';
    const along = face === 'south' || face === 'north' ? top.x + v.t * top.w : top.y + v.t * top.h;
    const half = cw / 2, proud = cw * 0.6;
    let x0: number, y0: number, sx: number, sy: number, ax: number, ay: number;
    if (face === 'south') { x0 = along - half; y0 = top.y + top.h; sx = cw; sy = proud; ax = along; ay = top.y + top.h + half; }
    else if (face === 'north') { x0 = along - half; y0 = top.y - proud; sx = cw; sy = proud; ax = along; ay = top.y - half; }
    else if (face === 'east') { x0 = top.x + top.w; y0 = along - half; sx = proud; sy = cw; ax = top.x + top.w + half; ay = along; }
    else { x0 = top.x - proud; y0 = along - half; sx = proud; sy = cw; ax = top.x - half; ay = along; }
    return { solid: await solidBox([x0, y0, 0], [sx, sy, topZ]), anchor: [ax, ay, topZ], mat };
  }

  // Ridge stack: centred on the ridge line, emerging from the roof slope.
  const ridge = ridgeAxisOf(w);
  const cx = ridge === 'x' ? top.x + v.t * top.w : top.x + top.w / 2;
  const cy = ridge === 'x' ? top.y + top.h / 2 : top.y + v.t * top.h;
  const baseZ = wallTop + rise * 0.4;
  const solid = await solidBox([cx - cw / 2, cy - cw / 2, baseZ], [cw, cw, topZ - baseZ]);
  return { solid, anchor: [cx, cy, topZ], mat };
}

export async function buildingFacets(
  wings: Wing[],
  wallMat: Mat = 'plaster',
  roofMat: Mat = 'tile',
  roofStyle: RoofStyle = 'gable',
  features: BuildingFeatures = {},
  seed = 0,
  apertures: ApertureBox[] = [],
): Promise<{ facets: WorldFacet[]; anchors: BuildingAnchors }> {
  const { Manifold } = await getManifold();
  // Walls: union every storey box of every wing (upper storeys grown by jetty), then
  // carve any openings (doors/windows) so they read as recesses, not proud boxes.
  const wallBoxes: Manifold[] = [];
  for (const w of wings) {
    const n = w.storeys ?? 1;
    for (let s = 0; s < n; s++) {
      const r = storeyRect(w, s);
      wallBoxes.push(await solidBox([r.x, r.y, s * STOREY], [r.w, r.h, STOREY]));
    }
  }
  const roofSolids = await Promise.all(wings.map(w => wingRoof(w, roofStyle)));
  const walls = await carveApertures(Manifold.union(wallBoxes), apertures);
  const roof = Manifold.union(roofSolids);

  const { vents } = resolveFeatures(wings, features, seed);
  const facets: WorldFacet[] = [
    ...manifoldToFacets(walls.getMesh(), wallMat),
    ...manifoldToFacets(roof.getMesh(), roofMat),
  ];
  const anchors: BuildingAnchors = { vents: [] };

  for (const v of vents) {
    const w = wings[v.wing] ?? wings[0];
    const c = await ventSolid(w, v, roofStyle);
    facets.push(...manifoldToFacets(c.solid.getMesh(), c.mat));
    anchors.vents.push(c.anchor);
  }
  return { facets, anchors };
}
