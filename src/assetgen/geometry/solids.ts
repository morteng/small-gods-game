// src/assetgen/geometry/solids.ts
import type { Vec3, RGB, Mat, WorldFacet } from '@/assetgen/types';
import { MATERIAL_RGB } from '@/assetgen/types';
import type { Mesh, Manifold } from 'manifold-3d';
import type { Vec2 } from '@/assetgen/types';
import { getManifold } from '@/assetgen/geometry/manifold-runtime';
import {
  STOREY, type Wing, type RoofKind, type RoofStyle, type RidgeAxis,
  type BuildingFeatures, type BuildingAnchors, type VentFeature, type VentKind, type WallFace,
  type DormerFeature,
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
    out.push({ pts: [a, b, d], normal: n, albedo: shadeRGB(c, brightness(n)), mat: material });
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

/**
 * Eave (across the ridge) + verge (along it) overhang per roof material, in
 * cube-units (1 unit = 2 m). Medieval rule: thatch overhangs far, shingle less,
 * tile less still; slate/stone roofs die into a masonry gable with a FLUSH verge.
 * See docs/reference/medieval-building-reference.md §1.
 */
interface RoofOverhang { eave: number; verge: number }
const ROOF_OVERHANG: Partial<Record<Mat, RoofOverhang>> = {
  thatch: { eave: 0.30, verge: 0.15 },   // 60 cm / 30 cm — thatch wants deep skirts
  timber: { eave: 0.24, verge: 0.12 },   // wood shingle
  tile:   { eave: 0.20, verge: 0.10 },
  stone:  { eave: 0.10, verge: 0 },      // slate over a masonry gable: flush verge
};

/**
 * Cap on how far the eave underside drops below the wall top (units). Deep
 * overhangs at full pitch would sweep below door heads (1-storey wall top
 * 1.35, door 1.0); medieval roofs solved this with SPROCKETED eaves — the
 * pitch flattens over the overhang. We approximate by re-pitching the whole
 * prism so the ridge stays at the flush-roof height while the eave edge
 * lands at `wallTop − min(pitch·eave, MAX_EAVE_DROP)`.
 */
const MAX_EAVE_DROP = 0.3;
function overhangOf(roofMat: Mat): RoofOverhang {
  return ROOF_OVERHANG[roofMat] ?? { eave: 0.12, verge: 0.06 };
}

/** Roof style a wing actually uses: per-wing override (`flat`/`pyramidal` collapse to
 *  the prism styles) else the building-wide style. */
function wingRoofStyle(w: Wing, style: RoofStyle): RoofStyle {
  const k: RoofKind | undefined = w.roof;
  if (k === 'gable') return 'gable';
  if (k === 'half_hip') return 'half_hip';
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

/** `rect` grown by `eave` across the ridge and `verge` along it. */
function grownRect(rect: WingRect, ridge: RidgeAxis, eave: number, verge: number): WingRect {
  return ridge === 'x'
    ? { x: rect.x - verge, y: rect.y - eave, w: rect.w + 2 * verge, h: rect.h + 2 * eave }
    : { x: rect.x - eave, y: rect.y - verge, w: rect.w + 2 * eave, h: rect.h + 2 * verge };
}

/**
 * Remove the part of an overhanging roof solid that would otherwise fill the top
 * `drop` of the wall faces: the roof prism is built over a GROWN rect with its base
 * dropped by `pitch·eave` (so the ridge height is unchanged and the eave edge hangs
 * below the wall top, as real eaves do) — but un-clipped, its below-wall-top interior
 * would read as a solid band hiding the upper wall. Subtracting a box slightly LARGER
 * than the wall rect (never coplanar with the wall faces — that z-fights) leaves only
 * the true eave wedge outside the wall planes.
 */
async function clipEaveInterior(roof: Manifold, wallRect: WingRect, wallTop: number, drop: number): Promise<Manifold> {
  if (drop <= 0) return roof;
  const eps = 0.02;
  const cutter = await solidBox(
    [wallRect.x - eps, wallRect.y - eps, wallTop - drop - 0.5],
    [wallRect.w + 2 * eps, wallRect.h + 2 * eps, drop + 0.5],
  );
  return roof.subtract(cutter);
}

/**
 * One wing's roof solid over its (possibly jettied) top rect, with material-driven
 * eave/verge overhangs. gable = one prism along the ridge axis; hip = two perpendicular
 * prisms intersected; half_hip = a gable clipped by an outward-shifted hip pair (the
 * thatch gablet, by construction); flat = a thin slab (no overhang — parapet roof).
 */
async function wingRoof(w: Wing, style: RoofStyle, roofMat: Mat = 'tile'): Promise<Manifold> {
  const top = storeyRect(w, (w.storeys ?? 1) - 1);
  const b = (w.storeys ?? 1) * (w.storeyHeight ?? STOREY);
  if (w.roof === 'flat') return solidBox([top.x, top.y, b], [top.w, top.h, 0.25]);
  const s = wingRoofStyle(w, style);
  const ridge = ridgeAxisOf(w);
  const { eave, verge } = overhangOf(roofMat);

  // Sprocketed-eave drop + the re-pitch that keeps the ridge at the
  // flush-roof height: rise over the grown half-span = flush rise + drop.
  const sprocket = (pitch: number, halfSpan: number): { drop: number; rePitch: number } => {
    const drop = Math.min(pitch * eave, MAX_EAVE_DROP);
    return { drop, rePitch: (pitch * halfSpan + drop) / (halfSpan + eave) };
  };

  if (s === 'gable') {
    const { drop, rePitch } = sprocket(GABLE_PITCH, crossSpan(top, ridge) / 2);
    const g = grownRect(top, ridge, eave, verge);
    const roof = await gablePrism(g, ridge, rePitch, b - drop);
    return clipEaveInterior(roof, top, b, drop);
  }

  if (s === 'half_hip') {
    const { drop, rePitch } = sprocket(GABLE_PITCH, crossSpan(top, ridge) / 2);
    const g = grownRect(top, ridge, eave, verge);
    const base = b - drop;
    const gable = await gablePrism(g, ridge, rePitch, base);
    // The end slopes: a perpendicular prism over the rect grown further along the
    // ridge, so its slope only clips the TOP of the gable triangle — the gablet
    // starts at ~55% of the rise.
    const rise = rePitch * (crossSpan(g, ridge) / 2);
    const ext = (0.55 * rise) / HIP_PITCH;
    const endRect = ridge === 'x'
      ? { x: g.x - ext, y: g.y, w: g.w + 2 * ext, h: g.h }
      : { x: g.x, y: g.y - ext, w: g.w, h: g.h + 2 * ext };
    const ends = await gablePrism(endRect, ridge === 'x' ? 'y' : 'x', HIP_PITCH, base);
    return clipEaveInterior(gable.intersect(ends), top, b, drop);
  }

  // hip: eaves all round (no gable wall to verge against); each axis prism
  // gets its own re-pitch so both planes still meet the unchanged ridge.
  const g: WingRect = { x: top.x - eave, y: top.y - eave, w: top.w + 2 * eave, h: top.h + 2 * eave };
  const dropH = Math.min(HIP_PITCH * eave, MAX_EAVE_DROP);
  const base = b - dropH;
  const pitchX = (HIP_PITCH * (top.h / 2) + dropH) / (g.h / 2);
  const pitchY = (HIP_PITCH * (top.w / 2) + dropH) / (g.w / 2);
  const px = await gablePrism(g, 'x', pitchX, base);
  const py = await gablePrism(g, 'y', pitchY, base);
  return clipEaveInterior(px.intersect(py), top, b, dropH);
}

/** Height the roof ridge reaches above a wing's wall top. (Overhang construction
 *  keeps the ridge height identical to the flush-roof formula.) */
function roofRise(w: Wing, style: RoofStyle): number {
  if (w.roof === 'flat') return 0.25;
  const top = storeyRect(w, (w.storeys ?? 1) - 1);
  const s = wingRoofStyle(w, style);
  const pitch = s === 'hip' ? HIP_PITCH : GABLE_PITCH;
  return pitch * (crossSpan(top, ridgeAxisOf(w)) / 2);
}

// ── attachable feature solids (own material, sit proud so the z-buffer shows them) ──

/** The width-units thickness + above-ridge protrusion + material for each vent kind.
 *  Medieval stacks are 0.6–1 m square rising ~1 m past the ridge; a smokehole is a
 *  timber ridge louvre, not a masonry stub. (1 unit = 2 m.) */
function ventProfile(kind: VentKind, v: VentFeature): { cw: number; protrude: number; mat: Mat } {
  switch (kind) {
    case 'pipe':      return { cw: v.width ?? 0.16, protrude: v.height ?? 0.9, mat: 'metal' };
    case 'smokehole': return { cw: v.width ?? 0.35, protrude: v.height ?? 0.35, mat: 'timber' };
    case 'chimney':   return { cw: v.width ?? 0.30, protrude: v.height ?? 0.55, mat: 'brick' };
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
  const wallTop = (w.storeys ?? 1) * (w.storeyHeight ?? STOREY);
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
  let solid = await solidBox([cx - cw / 2, cy - cw / 2, baseZ], [cw, cw, topZ - baseZ]);
  if (kind === 'smokehole') {
    // Ridge louvre: the timber box gets its own little gable cap so it reads as a
    // smoke louvre/gablet rather than a stub. Cap ridge runs along the main ridge.
    const o = 0.06;
    const capRect: WingRect = { x: cx - cw / 2 - o, y: cy - cw / 2 - o, w: cw + 2 * o, h: cw + 2 * o };
    solid = solid.add(await gablePrism(capRect, ridge, 0.9, topZ));
  }
  return { solid, anchor: [cx, cy, topZ], mat };
}

/**
 * A gabled dormer riding a wing's roof slope at fraction `t` along the ridge:
 * a wall-material face box buried back into the roof, capped by a mini gable
 * prism (roof material) whose ridge runs perpendicular to the main ridge. The
 * img2img pass paints the dormer's window; geometry only supplies the massing.
 */
async function dormerSolids(
  w: Wing, d: DormerFeature, style: RoofStyle,
): Promise<{ box: Manifold; cap: Manifold } | null> {
  const top = storeyRect(w, (w.storeys ?? 1) - 1);
  const wallTop = (w.storeys ?? 1) * (w.storeyHeight ?? STOREY);
  const rise = roofRise(w, style);
  if (w.roof === 'flat' || rise <= 0.5) return null;
  const ridge = ridgeAxisOf(w);
  const dw = d.width ?? 0.5;            // along the ridge
  const faceH = 0.42;
  const baseZ = wallTop + rise * 0.22;
  // Front face sits where the slope passes baseZ, nudged 0.12 proud of the slope.
  const halfSpan = crossSpan(top, ridge) / 2;
  const fromRidge = (1 - (baseZ - wallTop) / rise) * halfSpan + 0.12;
  const along = ridge === 'x' ? top.x + d.t * top.w : top.y + d.t * top.h;

  let at: Vec3, size: Vec3, capRect: WingRect;
  if (ridge === 'x') {
    // dormer faces the +y (south) slope
    const ridgeY = top.y + top.h / 2;
    at = [along - dw / 2, ridgeY, baseZ];
    size = [dw, fromRidge, faceH];
    capRect = { x: along - dw / 2, y: ridgeY, w: dw, h: fromRidge };
  } else {
    // dormer faces the +x (east) slope
    const ridgeX = top.x + top.w / 2;
    at = [ridgeX, along - dw / 2, baseZ];
    size = [fromRidge, dw, faceH];
    capRect = { x: ridgeX, y: along - dw / 2, w: fromRidge, h: dw };
  }
  const box = await solidBox(at, size);
  const cap = await gablePrism(capRect, ridge === 'x' ? 'y' : 'x', GABLE_PITCH * 0.8, baseZ + faceH);
  return { box, cap };
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
    const sh = w.storeyHeight ?? STOREY;
    for (let s = 0; s < n; s++) {
      const r = storeyRect(w, s);
      wallBoxes.push(await solidBox([r.x, r.y, s * sh], [r.w, r.h, sh]));
    }
  }
  const roofSolids = await Promise.all(wings.map(w => wingRoof(w, roofStyle, roofMat)));
  const walls = await carveApertures(Manifold.union(wallBoxes), apertures);
  let roof = Manifold.union(roofSolids);

  const { vents, dormers } = resolveFeatures(wings, features, seed);
  const dormerBoxes: Manifold[] = [];
  for (const d of dormers) {
    const w = wings[d.wing] ?? wings[0];
    const c = await dormerSolids(w, d, roofStyle);
    if (!c) continue;
    dormerBoxes.push(c.box);
    roof = roof.add(c.cap);
  }

  const facets: WorldFacet[] = [
    ...manifoldToFacets(
      dormerBoxes.length ? walls.add(Manifold.union(dormerBoxes)).getMesh() : walls.getMesh(),
      wallMat,
    ),
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
