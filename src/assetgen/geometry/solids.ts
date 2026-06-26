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

/** Post-and-lintel arch (two uprights + a spanning beam) as one unioned solid, spanning +x.
 *  `yaw` (degrees about Z, at the arch's footprint origin) rotates the whole frame so it can
 *  span +y instead — a bridge arch must run ALONG the deck's travel axis, and an ns deck needs
 *  the frame turned 90°. Default 0 keeps the historical +x frame byte-identical. */
export async function solidArch(at: Vec3, span: number, height: number, thickness: number, yaw = 0): Promise<Manifold> {
  const { Manifold } = await getManifold();
  const t = thickness;
  const left  = Manifold.cube([t, t, height]).translate([at[0], at[1], at[2]]);
  const right = Manifold.cube([t, t, height]).translate([at[0] + span - t, at[1], at[2]]);
  const beam  = Manifold.cube([span, t, t]).translate([at[0], at[1], at[2] + height]);
  const arch = Manifold.union([left, right, beam]);
  if (!yaw) return arch;
  // Rotate about the springing origin (at.x, at.y) so the frame pivots in place.
  return arch.translate([-at[0], -at[1], 0]).rotate([0, 0, yaw]).translate([at[0], at[1], 0]);
}

/** Absolute box to subtract from a wall solid (an opening's aperture). `yaw`, if set,
 *  rotates the box about its own centre by that many degrees around Z — so an opening on
 *  a round wall can sit radially flush to the curve instead of axis-aligned to the bbox. */
export interface ApertureBox { at: Vec3; size: Vec3; yaw?: number }

/** A solid box, optionally yawed about its own centre (degrees, around Z). */
async function solidBoxYawed(at: Vec3, size: Vec3, yaw?: number): Promise<Manifold> {
  const box = await solidBox(at, size);
  if (!yaw) return box;
  const cx = at[0] + size[0] / 2, cy = at[1] + size[1] / 2;
  return box.translate([-cx, -cy, 0]).rotate([0, 0, yaw]).translate([cx, cy, 0]);
}

/** Subtract a set of aperture boxes from a wall solid (carving openings). No-op if empty. */
export async function carveApertures(solid: Manifold, apertures: ApertureBox[] = []): Promise<Manifold> {
  if (!apertures.length) return solid;
  const { Manifold } = await getManifold();
  const holes = await Promise.all(apertures.map(a => solidBoxYawed(a.at, a.size, a.yaw)));
  return solid.subtract(Manifold.union(holes));
}

export { solidBoxYawed };

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

// Roof pitches (rise per unit of HALF the across-ridge span) and the mono-pitch slope.
// Exported so the world-space mount-anchor model (`to-mount-anchors.ts`) lands its
// ridge/gable/chimney sockets at the SAME heights the geometry actually builds — keep the
// two in lockstep (a divergence put the sprite tags below the real ridge, 2026-06-25).
export const GABLE_PITCH = 1.5, HIP_PITCH = 1.35;
// Mono-pitch (shed / lean-to) slope: rise per unit of across-ridge RUN. A shallower
// single plane than a gable's per-side slope — reads clearly as one-way without
// towering. The high side stands `SHED_SLOPE · span` above the low eave.
export const SHED_SLOPE = 0.5;
/** Height a ridge chimney stack stands proud of the roof slope it pierces (cube-units;
 *  1 = 2 m). Matches `ventProfile('chimney').protrude`. */
export const CHIMNEY_PROTRUDE = 0.55;

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
 * Extrude a 2D cross-section profile (in the plane perpendicular to the ridge:
 * u = across-ridge, z = height) along the ridge, landing it on `rect` at base z `b`.
 * The rotate/translate Euler angles were tuned empirically (see solids tests); every
 * roof solid (full triangle prism OR a single thick slope slab) shares this transform,
 * so a profile authored in (u, z) lands correctly regardless of ridge axis.
 */
async function extrudeAlongRidge(profile: [number, number][], rect: WingRect, ridge: RidgeAxis, b: number): Promise<Manifold> {
  const { Manifold } = await getManifold();
  return ridge === 'x'
    ? Manifold.extrude(profile, rect.w).rotate([90, 0, 90]).translate([rect.x, rect.y, b])
    : Manifold.extrude(profile, rect.h).rotate([90, 0, 0]).translate([rect.x, rect.y + rect.h, b]);
}

/** A full gable triangle prism over a wing rect (used by hip/half-hip intersections,
 *  dormer + louvre caps). `rise = pitch · half-span`. */
async function gablePrism(rect: WingRect, ridge: RidgeAxis, pitch: number, b: number): Promise<Manifold> {
  const span = ridge === 'x' ? rect.h : rect.w;
  const profile: [number, number][] = [[0, 0], [span, 0], [span / 2, pitch * (span / 2)]];
  return extrudeAlongRidge(profile, rect, ridge, b);
}

/** Roof board thickness (cube-units; 1 = 2 m) — the visible depth at every eave +
 *  verge edge once roofs are modelled as individual slope slabs rather than solid
 *  wedges. ~28 cm: a rafter + batten + covering sandwich. */
const ROOF_SLAB_T = 0.14;

/**
 * One sloped roof board as a thick parallelogram: the top surface runs from the eave
 * (uEave, 0) up to the ridge (uRidge, rise); the underside is that line offset by `t`
 * along the inward (downward) slope normal. Points are wound CCW (positive area) so
 * `Manifold.extrude` keeps it solid. Returned in (u, z) profile space.
 */
function slabProfile(uEave: number, uRidge: number, rise: number, t: number): [number, number][] {
  const du = uRidge - uEave, len = Math.hypot(du, rise) || 1;
  // inward normal (pointing down): perpendicular to the slope with negative z.
  let nu = rise / len, nz = -du / len;
  if (nz > 0) { nu = -nu; nz = -nz; }
  const ou = nu * t, oz = nz * t;
  const poly: [number, number][] = [[uEave, 0], [uEave + ou, oz], [uRidge + ou, rise + oz], [uRidge, rise]];
  // Manifold.extrude needs CCW (positive-area) polygons or it inverts the solid; a
  // slope falling the other way (uRidge < uEave — the right-hand board) comes out CW,
  // so reverse it. This was the bug that silently dropped one whole roof slope.
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i], [x1, y1] = poly[(i + 1) % poly.length];
    a += x0 * y1 - x1 * y0;
  }
  return a < 0 ? poly.reverse() : poly;
}

/** A gable roof as TWO thick slope slabs over the (eave+verge-grown) rect, meeting at
 *  the ridge. Replaces the solid wedge so eaves AND verges read as projecting boards. */
async function gableSlabs(grown: WingRect, ridge: RidgeAxis, rise: number, b: number): Promise<Manifold> {
  const span = ridge === 'x' ? grown.h : grown.w;
  const left = await extrudeAlongRidge(slabProfile(0, span / 2, rise, ROOF_SLAB_T), grown, ridge, b);
  const right = await extrudeAlongRidge(slabProfile(span, span / 2, rise, ROOF_SLAB_T), grown, ridge, b);
  return left.add(right);
}

/** The triangular gable wall (tympanum) closing each ridge END, at the UNGROWN wall
 *  plane so the slope slabs overhang it as a true verge. Thin (`gw`) prisms in
 *  wall material, one per end. */
async function gableEndWalls(top: WingRect, ridge: RidgeAxis, rise: number, wallTop: number, gw: number): Promise<Manifold> {
  const { Manifold } = await getManifold();
  const span = ridge === 'x' ? top.h : top.w;
  const tri: [number, number][] = [[0, 0], [span, 0], [span / 2, rise]];
  const len = ridge === 'x' ? top.w : top.h;
  const endRectAt = (off: number): WingRect => ridge === 'x'
    ? { x: top.x + off, y: top.y, w: gw, h: top.h }
    : { x: top.x, y: top.y + off, w: top.w, h: gw };
  const a = await extrudeAlongRidge(tri, endRectAt(0), ridge, wallTop);
  const b = await extrudeAlongRidge(tri, endRectAt(len - gw), ridge, wallTop);
  return Manifold.union([a, b]);
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

/** A wing's roof, split into the roof-material solid + (gable styles only) the
 *  wall-material tympanum that closes each ridge end behind the projecting verge. */
interface WingRoof { roof: Manifold; gableWalls?: Manifold }

/**
 * A mono-pitch (shed / lean-to) roof: ONE sloped board over the whole footprint,
 * low at the across-ridge start, high at the far edge. Unlike a gable (two slopes
 * meeting at a central ridge) the plane runs the FULL span. Wall-material infill
 * closes the two raking ends (right triangles) and the tall back wall (a strip from
 * wall top up to the high eave); both fold into the wall solid like a gable tympanum.
 */
async function shedRoof(w: Wing, roofMat: Mat): Promise<WingRoof> {
  const { Manifold } = await getManifold();
  const top = storeyRect(w, (w.storeys ?? 1) - 1);
  const b = (w.storeys ?? 1) * (w.storeyHeight ?? STOREY);
  const ridge = ridgeAxisOf(w);
  const { eave, verge } = overhangOf(roofMat);
  const span = crossSpan(top, ridge);              // across-ridge run (low → high)
  const rise = SHED_SLOPE * span;

  // The single slope slab, over the eave/verge-grown rect so it overhangs all round.
  const g = grownRect(top, ridge, eave, verge);
  const gspan = crossSpan(g, ridge);
  const riseG = SHED_SLOPE * gspan;
  const roof = await extrudeAlongRidge(slabProfile(0, gspan, riseG, ROOF_SLAB_T), g, ridge, b);

  // Infill walls (wall material), at the UNGROWN plane so the slab overhangs them.
  const gw = 0.1;
  const tri: [number, number][] = [[0, 0], [span, 0], [span, rise]];   // raking end: 0 → rise
  const len = ridge === 'x' ? top.w : top.h;
  const endRectAt = (off: number): WingRect => ridge === 'x'
    ? { x: top.x + off, y: top.y, w: gw, h: top.h }
    : { x: top.x, y: top.y + off, w: top.w, h: gw };
  const e1 = await extrudeAlongRidge(tri, endRectAt(0), ridge, b);
  const e2 = await extrudeAlongRidge(tri, endRectAt(len - gw), ridge, b);
  // The tall back wall on the HIGH across-edge: a strip from wall top up to the eave.
  const highWall = ridge === 'x'
    ? await solidBox([top.x, top.y + top.h - gw, b], [top.w, gw, rise])
    : await solidBox([top.x + top.w - gw, top.y, b], [gw, top.h, rise]);
  return { roof, gableWalls: Manifold.union([e1, e2, highWall]) };
}

/**
 * One wing's roof, modelled as individual sloped boards (real thickness, projecting
 * eaves + verges) rather than a solid wedge:
 *  - gable     = two thick slope slabs + recessed triangular gable walls (so the
 *                verge is the slabs overhanging the wall, not a flush solid end).
 *  - half_hip  = the gable slabs with the upper triangle clipped to a gablet, plus
 *                the end hip slabs; the short gable wall sits under the gablet.
 *  - hip       = four slope planes, shelled to a board thickness (eaves all round).
 *  - flat      = a thin slab (parapet roof).
 */
async function wingRoof(w: Wing, style: RoofStyle, roofMat: Mat = 'tile'): Promise<WingRoof> {
  const top = storeyRect(w, (w.storeys ?? 1) - 1);
  const b = (w.storeys ?? 1) * (w.storeyHeight ?? STOREY);
  if (w.roof === 'flat') return { roof: await solidBox([top.x, top.y, b], [top.w, top.h, 0.25]) };
  if (w.roof === 'shed') return shedRoof(w, roofMat);
  const s = wingRoofStyle(w, style);
  const ridge = ridgeAxisOf(w);
  const { eave, verge } = overhangOf(roofMat);

  // Sprocketed-eave drop + the re-pitch that keeps the ridge at the flush-roof
  // height: rise over the grown half-span = flush rise + drop.
  const sprocket = (pitch: number, halfSpan: number): { drop: number; rePitch: number } => {
    const drop = Math.min(pitch * eave, MAX_EAVE_DROP);
    return { drop, rePitch: (pitch * halfSpan + drop) / (halfSpan + eave) };
  };
  const wallRise = GABLE_PITCH * (crossSpan(top, ridge) / 2);   // ridge height above wall top

  if (s === 'gable') {
    const { drop, rePitch } = sprocket(GABLE_PITCH, crossSpan(top, ridge) / 2);
    const g = grownRect(top, ridge, eave, verge);
    const rise = rePitch * (crossSpan(g, ridge) / 2);
    const roof = await gableSlabs(g, ridge, rise, b - drop);
    const gableWalls = await gableEndWalls(top, ridge, wallRise, b, 0.1);
    return { roof, gableWalls };
  }

  if (s === 'half_hip') {
    const { drop, rePitch } = sprocket(GABLE_PITCH, crossSpan(top, ridge) / 2);
    const g = grownRect(top, ridge, eave, verge);
    const base = b - drop;
    const rise = rePitch * (crossSpan(g, ridge) / 2);
    // Two main slope slabs, their upper triangle clipped to the gablet by the end
    // hip pair; the end hip slabs fill the gablet faces.
    const ext = (0.55 * rise) / HIP_PITCH;
    const endRidge: RidgeAxis = ridge === 'x' ? 'y' : 'x';
    const endRect = ridge === 'x'
      ? { x: g.x - ext, y: g.y, w: g.w + 2 * ext, h: g.h }
      : { x: g.x, y: g.y - ext, w: g.w, h: g.h + 2 * ext };
    const endClip = await gablePrism(endRect, endRidge, HIP_PITCH, base);
    const mainSlabs = (await gableSlabs(g, ridge, rise, base)).intersect(endClip);
    const endSpan = ridge === 'x' ? endRect.w : endRect.h;
    const endRise = HIP_PITCH * (endSpan / 2);
    const endSlabs = (await gableSlabs(endRect, endRidge, endRise, base))
      .intersect(await gablePrism(g, ridge, rePitch, base));
    // Short gable wall: only up to where the gablet starts (~45% of the wall rise).
    const gabletBase = wallRise * 0.45;
    const gableWalls = (await gableEndWalls(top, ridge, wallRise, b, 0.1))
      .intersect(await solidBox([top.x - 1, top.y - 1, b], [top.w + 2, top.h + 2, gabletBase]));
    return { roof: mainSlabs.add(endSlabs), gableWalls };
  }

  // hip: four slope planes, eaves all round, no gable. Build the solid hip then shell
  // it to a board thickness (subtract an inset copy) so edges read with depth.
  const g: WingRect = { x: top.x - eave, y: top.y - eave, w: top.w + 2 * eave, h: top.h + 2 * eave };
  const dropH = Math.min(HIP_PITCH * eave, MAX_EAVE_DROP);
  const base = b - dropH;
  const pitchX = (HIP_PITCH * (top.h / 2) + dropH) / (g.h / 2);
  const pitchY = (HIP_PITCH * (top.w / 2) + dropH) / (g.w / 2);
  const px = await gablePrism(g, 'x', pitchX, base);
  const py = await gablePrism(g, 'y', pitchY, base);
  const solid = await clipEaveInterior(px.intersect(py), top, b, dropH);
  // Shell: subtract the same hip scaled down so a ROOF_SLAB_T-ish board remains.
  const innerInset = ROOF_SLAB_T;
  const gi: WingRect = { x: g.x + innerInset, y: g.y + innerInset, w: g.w - 2 * innerInset, h: g.h - 2 * innerInset };
  const ipx = await gablePrism(gi, 'x', pitchX, base - ROOF_SLAB_T * 2);
  const ipy = await gablePrism(gi, 'y', pitchY, base - ROOF_SLAB_T * 2);
  const inner = ipx.intersect(ipy);
  return { roof: solid.subtract(inner) };
}

/** Height the roof ridge reaches above a wing's wall top. (Overhang construction
 *  keeps the ridge height identical to the flush-roof formula.) */
function roofRise(w: Wing, style: RoofStyle): number {
  if (w.roof === 'flat') return 0.25;
  const top = storeyRect(w, (w.storeys ?? 1) - 1);
  if (w.roof === 'shed') return SHED_SLOPE * crossSpan(top, ridgeAxisOf(w));
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

  // Ridge vent, emerging from a roof slope. EVERY ridge vent — masonry chimney, metal
  // pipe, OR timber smoke-louvre — is OFFSET to one side of the ridge so it passes
  // BESIDE the ridge beam/purlin rather than through it. Piercing the ridge timber
  // would weaken the roof; real stacks clear it (or climb a gable-end wall) and even a
  // smoke-louvre is framed beside/over the ridge, never stabbed straight down through
  // the structural beam. The vent still rises past the ridge height.
  const ridge = ridgeAxisOf(w);
  const halfSpan = crossSpan(top, ridge) / 2;
  // Across-ridge offset: clear the ridge line by the vent half-width + a gap, but stay
  // on the slope (cap to ~55% of the half-span).
  const off = Math.min(cw / 2 + 0.08, halfSpan * 0.55);
  // Offset toward +cross (the camera-facing front slope: +y=south for an x-ridge,
  // +x=east for a y-ridge) so the visible side carries the stack.
  const cx = ridge === 'x' ? top.x + v.t * top.w : top.x + top.w / 2 + off;
  const cy = ridge === 'x' ? top.y + top.h / 2 + off : top.y + v.t * top.h;
  // Base from the wall top so the stack reads as masonry rising from inside and
  // visibly pierces the slope at the offset (the slope there is below the ridge).
  const baseZ = wallTop;
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
  const wingRoofs = await Promise.all(wings.map(w => wingRoof(w, roofStyle, roofMat)));
  let walls = await carveApertures(Manifold.union(wallBoxes), apertures);
  // Gable tympanums are WALL material — fold them into the wall solid (above the
  // openings, so no aperture interaction) so the recessed gable reads as masonry/timber.
  const gableWalls = wingRoofs.map(r => r.gableWalls).filter((m): m is Manifold => !!m);
  if (gableWalls.length) walls = walls.add(Manifold.union(gableWalls));
  let roof = Manifold.union(wingRoofs.map(r => r.roof));

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
