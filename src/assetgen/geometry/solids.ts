// src/assetgen/geometry/solids.ts
import type { Vec3, RGB, Mat, WorldFacet, SurfaceFrame } from '@/assetgen/types';
import { MATERIAL_RGB } from '@/assetgen/types';
import type { Mesh, Manifold } from 'manifold-3d';
import type { Vec2 } from '@/assetgen/types';
import { getManifold } from '@/assetgen/geometry/manifold-runtime';
import { archHeadCutter, type ArchStyle } from '@/assetgen/geometry/arch';
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
/** Authors a per-facet UV frame (KU) from its centroid + outward normal; `undefined` ⇒ the
 *  texturer derives a tangent frame from the normal (the default for flat box faces). */
export type FacetProjector = (centroid: Vec3, normal: Vec3) => SurfaceFrame | undefined;

/** Cylindrical unwrap about a vertical axis at `center`: barrel side facets get an angular
 *  frame (u = θ·radius wraps seamlessly, v = world-z); the near-horizontal top/bottom caps
 *  fall back to the normal-derived planar frame. For round towers / columns / wells. */
export function cylindricalProjector(center: [number, number], radius: number): FacetProjector {
  const [cx, cy] = center;
  return (_c, n): SurfaceFrame | undefined => {
    const az = Math.abs(n[2]);
    if (az >= Math.abs(n[0]) && az >= Math.abs(n[1])) return undefined;  // a cap, not the barrel
    return { kind: 'cylindrical', cx, cy, radius };
  };
}

export function manifoldToFacets(mesh: Mesh, material: Mat, work?: string, projector?: FacetProjector, finish?: string, tint?: RGB): WorldFacet[] {
  const c = MATERIAL_RGB[material];
  const { numProp, vertProperties: vp, triVerts: tv } = mesh;
  const pos = (i: number): Vec3 => [vp[i*numProp], vp[i*numProp+1], vp[i*numProp+2]];
  const out: WorldFacet[] = [];
  for (let t = 0; t < tv.length; t += 3) {
    const a = pos(tv[t]), b = pos(tv[t+1]), d = pos(tv[t+2]);
    const n = cross(sub(b, a), sub(d, a));         // outward (manifold winding is CCW-outward)
    if (n[0] === 0 && n[1] === 0 && n[2] === 0) continue; // skip degenerate
    const frame = projector?.([(a[0]+b[0]+d[0])/3, (a[1]+b[1]+d[1])/3, (a[2]+b[2]+d[2])/3], n);
    out.push({ pts: [a, b, d], normal: n, albedo: shadeRGB(c, brightness(n)), mat: material, work, finish, tint, frame });
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

/** Segments for a round solid of `radius` (tiles): chord ≈ 0.12 tiles (~2–3 px at art
 *  scale) so towers/spires/domes stop reading polygonal under per-facet flat shading.
 *  Clamped 24..96, multiple of 4. Deterministic in radius — golden-pinned. */
export function roundSegments(radius: number): number {
  return Math.max(24, Math.min(96, Math.ceil((2 * Math.PI * radius) / 0.12 / 4) * 4));
}

/** Vertical cylinder, base centred at (cx,cy,baseZ). */
export async function solidCylinder(center: Vec2, baseZ: number, radius: number, height: number): Promise<Manifold> {
  const { Manifold } = await getManifold();
  return Manifold.cylinder(height, radius, radius, roundSegments(radius)).translate([center[0], center[1], baseZ]);
}

/** Cone/frustum, base centred at (cx,cy,baseZ); radiusBase at bottom → radiusTop at top. */
export async function solidCone(center: Vec2, baseZ: number, radiusTop: number, radiusBase: number, height: number): Promise<Manifold> {
  const { Manifold } = await getManifold();
  const segs = roundSegments(Math.max(radiusBase, radiusTop));
  return Manifold.cylinder(height, radiusBase, radiusTop, segs).translate([center[0], center[1], baseZ]);
}

/** Regular n-gon prism (n sides), base centred at (cx,cy,baseZ). */
export async function solidPrism(center: Vec2, baseZ: number, radius: number, height: number, sides: number): Promise<Manifold> {
  const { Manifold } = await getManifold();
  return Manifold.cylinder(height, radius, radius, sides).translate([center[0], center[1], baseZ]);
}

/** Rectangular pyramid over an axis-aligned footprint: a `2·halfW × 2·halfH` base centred at
 *  (cx,cy,baseZ), tapering to an apex at (cx,cy,baseZ+height). A true 4-sided taper (NOT a round
 *  cone) — the correct spire/roof for a SQUARE tower, whose four base edges meet the square wall
 *  top flush (a cone leaves the corners exposed). Built from a unit 4-gon cone rotated 45° so its
 *  base vertices land on the axis-aligned corners, then scaled to the footprint. */
export async function solidPyramid(center: Vec2, baseZ: number, halfW: number, halfH: number, height: number): Promise<Manifold> {
  const { Manifold } = await getManifold();
  // cylinder(h, rBase, rTop=0, 4) → square-base pyramid; base verts at radius √½ sit at angles
  // 0/90/180/270, so a 45° spin lands them on (±½,±½) — the unit square. Scale to [w,h,height].
  return Manifold.cylinder(1, Math.SQRT1_2, 0, 4)
    .rotate([0, 0, 45])
    .scale([2 * halfW, 2 * halfH, height])
    .translate([center[0], center[1], baseZ]);
}

/** Ellipsoid centred at (cx,cy,baseZ+rz), radii [rx,ry,rz]. */
export async function solidEllipsoid(center: Vec2, baseZ: number, radii: Vec3): Promise<Manifold> {
  const { Manifold } = await getManifold();
  const segs = roundSegments(Math.max(radii[0], radii[1]));
  return Manifold.sphere(1, segs).scale(radii).translate([center[0], center[1], baseZ + radii[2]]);
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
 *  a round wall can sit radially flush to the curve instead of axis-aligned to the bbox.
 *  `arch`, if set, adds a curved head cutter on TOP of the box (K2) so the opening gets
 *  an arched head instead of a square one — `axis` is the wall-run direction, `rise` the
 *  head height above the box top (round ⇒ half the opening width). */
export interface ApertureBox {
  at: Vec3; size: Vec3; yaw?: number;
  arch?: { axis: 'x' | 'y'; style: ArchStyle; rise: number };
}

/** A solid box, optionally yawed about its own centre (degrees, around Z). */
async function solidBoxYawed(at: Vec3, size: Vec3, yaw?: number): Promise<Manifold> {
  const box = await solidBox(at, size);
  if (!yaw) return box;
  const cx = at[0] + size[0] / 2, cy = at[1] + size[1] / 2;
  return box.translate([-cx, -cy, 0]).rotate([0, 0, yaw]).translate([cx, cy, 0]);
}

/** One aperture cutter: the recess box, plus (if `arch` is set) a curved head on top. */
async function apertureCutter(a: ApertureBox): Promise<Manifold> {
  const box = await solidBoxYawed(a.at, a.size, a.yaw);
  if (!a.arch) return box;
  const head = await archHeadCutter(a.at, a.size, a.arch.axis, a.arch.style, a.arch.rise);
  return box.add(head);
}

/** Subtract a set of aperture boxes from a wall solid (carving openings). No-op if empty. */
export async function carveApertures(solid: Manifold, apertures: ApertureBox[] = []): Promise<Manifold> {
  if (!apertures.length) return solid;
  const { Manifold } = await getManifold();
  const holes = await Promise.all(apertures.map(apertureCutter));
  return solid.subtract(Manifold.union(holes));
}

export { solidBoxYawed };

/** A solid box rotated by Euler `rot` (degrees, X/Y/Z) about its own centre — lets a member
 *  tilt WITHIN a wall plane (a diagonal brace): rot about Y tilts a south/north-face box in
 *  its x–z plane, rot about X tilts an east/west-face box in its y–z plane. rot≈0 is a no-op
 *  (returns the plain box), so any box without `rot` is byte-identical to before. */
export async function solidBoxRot(at: Vec3, size: Vec3, rot?: Vec3): Promise<Manifold> {
  const box = await solidBox(at, size);
  if (!rot || (!rot[0] && !rot[1] && !rot[2])) return box;
  const c: Vec3 = [at[0] + size[0] / 2, at[1] + size[1] / 2, at[2] + size[2] / 2];
  return box.translate([-c[0], -c[1], -c[2]]).rotate(rot).translate([c[0], c[1], c[2]]);
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

// Roof pitches (rise per unit of HALF the across-ridge span) and the mono-pitch slope.
// Exported so the world-space mount-anchor model (`to-mount-anchors.ts`) lands its
// ridge/gable/chimney sockets at the SAME heights the geometry actually builds — keep the
// two in lockstep (a divergence put the sprite tags below the real ridge, 2026-06-25).
export const GABLE_PITCH = 1.5, HIP_PITCH = 1.35;
/** A wing's gable pitch: its per-wing override, else the global default. */
const pitchOf = (w: Wing): number => w.pitch ?? GABLE_PITCH;
// Mono-pitch (shed / lean-to) slope: rise per unit of across-ridge RUN. A shallower
// single plane than a gable's per-side slope — reads clearly as one-way without
// towering. The high side stands `SHED_SLOPE · span` above the low eave.
export const SHED_SLOPE = 0.5;
/** Height a ridge chimney stack stands proud of the roof slope it pierces (cube-units;
 *  1 = 2 m). Matches `ventProfile('chimney').protrude`. */
export const CHIMNEY_PROTRUDE = 0.55;
// Two-pitch + asymmetric roof shape constants (exported: `to-mount-anchors.ts` mirrors
// them without importing this heavy module — keep the copies in lockstep, guarded by
// tests/unit/mount-anchor-geometry-parity.test.ts).
/** Gambrel break knot: fraction of the half-span run / of the total rise. The lower barn
 *  slope is steep (0.72R over 0.4·hs ≈ 2.7 pitch), the upper shallow; the ridge height
 *  matches a plain gable so massing/anchors are unchanged at the crest. */
export const GAMBREL_BREAK = { u: 0.4, z: 0.72 } as const;
/** Mansard total rise per unit half-span (shallower crest than HIP_PITCH). */
export const MANSARD_RISE_K = 1.1;
/** Mansard break knot: the lower band climbs 0.8R over 0.28·hs (≈72°), the cap eases off. */
export const MANSARD_BREAK = { u: 0.28, z: 0.8 } as const;
/** Saltbox: the ridge sits at this fraction ACROSS the span (from the −cross side), so
 *  the long catslide faces the +cross camera slope. Ridge rise = GABLE_PITCH · t · span. */
export const SALTBOX_RIDGE_T = 0.35;

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
  if (k === 'gable' || k === 'gambrel' || k === 'saltbox' || k === 'cross_gable') return 'gable';
  if (k === 'half_hip') return 'half_hip';
  if (k === 'hip' || k === 'pyramidal' || k === 'mansard') return 'hip';
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
 * One sloped roof board as a thick parallelogram: the top surface runs from (u0, z0)
 * to (u1, z1); the underside is that line offset by `t` along the inward (downward)
 * slope normal. Points are wound CCW (positive area) so `Manifold.extrude` keeps it
 * solid. Returned in (u, z) profile space. Two-pitch roofs (gambrel/mansard) chain
 * these segment boards; the union at the break knot heals into one surface.
 */
function slabSeg(u0: number, z0: number, u1: number, z1: number, t: number): [number, number][] {
  const du = u1 - u0, dz = z1 - z0, len = Math.hypot(du, dz) || 1;
  // inward normal (pointing down): perpendicular to the slope with negative z.
  let nu = dz / len, nz = -du / len;
  if (nz > 0) { nu = -nu; nz = -nz; }
  const ou = nu * t, oz = nz * t;
  const poly: [number, number][] = [[u0, z0], [u0 + ou, z0 + oz], [u1 + ou, z1 + oz], [u1, z1]];
  // Manifold.extrude needs CCW (positive-area) polygons or it inverts the solid; a
  // slope falling the other way (u1 < u0 — the right-hand board) comes out CW,
  // so reverse it. This was the bug that silently dropped one whole roof slope.
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i], [x1, y1] = poly[(i + 1) % poly.length];
    a += x0 * y1 - x1 * y0;
  }
  return a < 0 ? poly.reverse() : poly;
}

/** A single-pitch board from the eave (uEave, 0) to the ridge (uRidge, rise). */
function slabProfile(uEave: number, uRidge: number, rise: number, t: number): [number, number][] {
  return slabSeg(uEave, 0, uRidge, rise, t);
}

/** A gable roof as TWO thick slope slabs over the (eave+verge-grown) rect, meeting at
 *  the ridge. Replaces the solid wedge so eaves AND verges read as projecting boards. */
async function gableSlabs(grown: WingRect, ridge: RidgeAxis, rise: number, b: number): Promise<Manifold> {
  const span = ridge === 'x' ? grown.h : grown.w;
  const left = await extrudeAlongRidge(slabProfile(0, span / 2, rise, ROOF_SLAB_T), grown, ridge, b);
  const right = await extrudeAlongRidge(slabProfile(span, span / 2, rise, ROOF_SLAB_T), grown, ridge, b);
  return left.add(right);
}

/** Tympanum top-edge recess: the raking edges are CONSTRUCTIONALLY coplanar with the
 *  slope boards' top planes (the sprocket re-pitch passes through the same knots), which
 *  z-fights as a pale stipple along every verge. Scaling the wall profile's z tucks the
 *  edge INSIDE the board's thickness (top − ~ROOF_SLAB_T) without opening a gap. */
const TYMPANUM_RECESS = 0.92;

/** The gable wall (tympanum) closing each ridge END, at the UNGROWN wall plane so
 *  the slope slabs overhang it as a true verge. Thin (`gw`) prisms in wall material,
 *  one per end. `profile` is the tympanum polygon in (u, z) — a triangle for a plain
 *  gable, a pentagon for a gambrel, an off-peak triangle for a saltbox. */
async function endWallsOfProfile(
  top: WingRect, ridge: RidgeAxis, rawProfile: [number, number][], wallTop: number, gw: number,
): Promise<Manifold> {
  const { Manifold } = await getManifold();
  const profile = rawProfile.map(([u, z]) => [u, z * TYMPANUM_RECESS] as [number, number]);
  const len = ridge === 'x' ? top.w : top.h;
  const endRectAt = (off: number): WingRect => ridge === 'x'
    ? { x: top.x + off, y: top.y, w: gw, h: top.h }
    : { x: top.x, y: top.y + off, w: top.w, h: gw };
  const a = await extrudeAlongRidge(profile, endRectAt(0), ridge, wallTop);
  const b = await extrudeAlongRidge(profile, endRectAt(len - gw), ridge, wallTop);
  return Manifold.union([a, b]);
}

async function gableEndWalls(top: WingRect, ridge: RidgeAxis, rise: number, wallTop: number, gw: number): Promise<Manifold> {
  const span = ridge === 'x' ? top.h : top.w;
  return endWallsOfProfile(top, ridge, [[0, 0], [span, 0], [span / 2, rise]], wallTop, gw);
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

/** Sprocketed-eave drop + the re-pitch that keeps the ridge at the flush-roof height:
 *  rise over the grown half-span = flush rise + drop. */
function sprocketFor(pitch: number, halfSpan: number, eave: number): { drop: number; rePitch: number } {
  const drop = Math.min(pitch * eave, MAX_EAVE_DROP);
  return { drop, rePitch: (pitch * halfSpan + drop) / (halfSpan + eave) };
}

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
 * A gambrel (barn) roof: each side is TWO chained slope boards — steep below the break
 * knot, shallow above — meeting at the same ridge height a plain gable would reach.
 * The tympanum closing each end is the matching pentagon.
 */
async function gambrelRoof(w: Wing, roofMat: Mat): Promise<WingRoof> {
  const top = storeyRect(w, (w.storeys ?? 1) - 1);
  const b = (w.storeys ?? 1) * (w.storeyHeight ?? STOREY);
  const ridge = ridgeAxisOf(w);
  const { eave, verge } = overhangOf(roofMat);
  const span = crossSpan(top, ridge), hs = span / 2;
  const R = GABLE_PITCH * hs;                       // ridge parity with a plain gable
  const uB = GAMBREL_BREAK.u * hs, zB = GAMBREL_BREAK.z * R;
  const drop = Math.min((zB / uB) * eave, MAX_EAVE_DROP);
  const g = grownRect(top, ridge, eave, verge);
  const gspan = crossSpan(g, ridge), gHalf = gspan / 2;
  // Knots in grown coords, base at b − drop: the break/ridge stay at their world heights
  // (b+zB / b+R) while the eave edge hangs `drop` below the wall top.
  const uBk = eave + uB, zBk = drop + zB, zR = drop + R;
  const base = b - drop;
  const boards = [
    slabSeg(0, 0, uBk, zBk, ROOF_SLAB_T), slabSeg(uBk, zBk, gHalf, zR, ROOF_SLAB_T),
    slabSeg(gspan, 0, gspan - uBk, zBk, ROOF_SLAB_T), slabSeg(gspan - uBk, zBk, gHalf, zR, ROOF_SLAB_T),
  ];
  let roof: Manifold | undefined;
  for (const p of boards) {
    const m = await extrudeAlongRidge(p, g, ridge, base);
    roof = roof ? roof.add(m) : m;
  }
  const pent: [number, number][] = [[0, 0], [span, 0], [span - uB, zB], [hs, R], [uB, zB]];
  return { roof: roof!, gableWalls: await endWallsOfProfile(top, ridge, pent, b, 0.1) };
}

/**
 * A saltbox roof: an asymmetric gable whose ridge sits at SALTBOX_RIDGE_T across the
 * span — a short steep slope on the −cross side, a long shallow catslide sweeping
 * toward the +cross (camera-facing) eave.
 */
async function saltboxRoof(w: Wing, roofMat: Mat): Promise<WingRoof> {
  const top = storeyRect(w, (w.storeys ?? 1) - 1);
  const b = (w.storeys ?? 1) * (w.storeyHeight ?? STOREY);
  const ridge = ridgeAxisOf(w);
  const { eave, verge } = overhangOf(roofMat);
  const span = crossSpan(top, ridge);
  const uR = SALTBOX_RIDGE_T * span;
  const R = GABLE_PITCH * uR;                       // steep side carries the full gable pitch
  // PER-SIDE sprocket drops: the shallow catslide must not inherit the steep side's
  // eave drop, or its whole plane dives below the tympanum's raking edge (a visible
  // wall stripe through the roof). Boards extrude at base b with negative eave knots.
  const pitchCat = R / (span - uR);
  const dropS = Math.min(GABLE_PITCH * eave, MAX_EAVE_DROP);
  const dropC = Math.min(pitchCat * eave, MAX_EAVE_DROP);
  const g = grownRect(top, ridge, eave, verge);
  const gspan = crossSpan(g, ridge);
  const uRk = eave + uR;
  const short = await extrudeAlongRidge(slabSeg(0, -dropS, uRk, R, ROOF_SLAB_T), g, ridge, b);
  const catslide = await extrudeAlongRidge(slabSeg(gspan, -dropC, uRk, R, ROOF_SLAB_T), g, ridge, b);
  const tri: [number, number][] = [[0, 0], [span, 0], [uR, R]];
  return { roof: short.add(catslide), gableWalls: await endWallsOfProfile(top, ridge, tri, b, 0.1) };
}

/**
 * A mansard roof: a steep four-sided lower band up to the break, capped by a shallow
 * hip — built as a solid (two prism intersections stacked) then shelled to a board
 * thickness like the plain hip, so eaves read with depth all round.
 */
async function mansardRoof(w: Wing, roofMat: Mat): Promise<WingRoof> {
  const top = storeyRect(w, (w.storeys ?? 1) - 1);
  const b = (w.storeys ?? 1) * (w.storeyHeight ?? STOREY);
  const { eave } = overhangOf(roofMat);
  const hs = crossSpan(top, ridgeAxisOf(w)) / 2;
  const R = MANSARD_RISE_K * hs;
  const zB = MANSARD_BREAK.z * R, uB = MANSARD_BREAK.u * hs;
  const drop = Math.min((zB / uB) * eave, MAX_EAVE_DROP);

  // One mansard massing over `rect`: a steep band clipped at the break + the shallow cap
  // over the inset rect. `p1 = breakZ / inset` puts the band's surface exactly at the
  // break height a horizontal `inset` in from the rect edge, on all four sides.
  const massing = async (rect: WingRect, base: number, breakZ: number, capRise: number, inset: number): Promise<Manifold> => {
    const p1 = breakZ / inset;
    const bandX = await gablePrism(rect, 'x', p1, base);
    const bandY = await gablePrism(rect, 'y', p1, base);
    const clip = await solidBox([rect.x - 1, rect.y - 1, base], [rect.w + 2, rect.h + 2, breakZ]);
    const band = bandX.intersect(bandY).intersect(clip);
    const gi: WingRect = { x: rect.x + inset, y: rect.y + inset, w: rect.w - 2 * inset, h: rect.h - 2 * inset };
    const p2 = capRise / (Math.min(gi.w, gi.h) / 2);
    const capX = await gablePrism(gi, 'x', p2, base + breakZ);
    const capY = await gablePrism(gi, 'y', p2, base + breakZ);
    return band.add(capX.intersect(capY));
  };

  const g: WingRect = { x: top.x - eave, y: top.y - eave, w: top.w + 2 * eave, h: top.h + 2 * eave };
  const outer = await massing(g, b - drop, zB + drop, R - zB, uB + eave);
  const gi: WingRect = { x: g.x + ROOF_SLAB_T, y: g.y + ROOF_SLAB_T, w: g.w - 2 * ROOF_SLAB_T, h: g.h - 2 * ROOF_SLAB_T };
  const inner = await massing(gi, b - drop - 2 * ROOF_SLAB_T, zB + drop, R - zB, uB + eave);
  const roof = await clipEaveInterior(outer.subtract(inner), top, b, drop);
  return { roof };
}

/**
 * A cross-gable roof: the plain gable plus a perpendicular gabled BAY crossing the
 * ridge at mid-run — same pitch, so the two ridges meet at one height and the bay's
 * tympana rise through the long eaves as camera-facing gable faces. Wings too square
 * for a distinct bay (length < 1.6 × span) fall back to the plain gable.
 */
async function crossGableRoof(w: Wing, roofMat: Mat): Promise<WingRoof> {
  const top = storeyRect(w, (w.storeys ?? 1) - 1);
  const b = (w.storeys ?? 1) * (w.storeyHeight ?? STOREY);
  const ridge = ridgeAxisOf(w);
  const { eave, verge } = overhangOf(roofMat);
  const span = crossSpan(top, ridge);
  const { drop, rePitch } = sprocketFor(GABLE_PITCH, span / 2, eave);
  const wallRise = GABLE_PITCH * (span / 2);
  const g = grownRect(top, ridge, eave, verge);
  const main = await gableSlabs(g, ridge, rePitch * (crossSpan(g, ridge) / 2), b - drop);
  const mainWalls = await gableEndWalls(top, ridge, wallRise, b, 0.1);
  const len = ridge === 'x' ? top.w : top.h;
  if (len < span * 1.6) return { roof: main, gableWalls: mainWalls };
  const c = ridge === 'x' ? top.x + top.w / 2 : top.y + top.h / 2;
  const bay: WingRect = ridge === 'x'
    ? { x: c - span / 2, y: top.y, w: span, h: top.h }
    : { x: top.x, y: c - span / 2, w: top.w, h: span };
  const crossRidge: RidgeAxis = ridge === 'x' ? 'y' : 'x';
  const gBay = grownRect(bay, crossRidge, eave, verge);
  const bayRoof = await gableSlabs(gBay, crossRidge, rePitch * (crossSpan(gBay, crossRidge) / 2), b - drop);
  const bayWalls = await gableEndWalls(bay, crossRidge, wallRise, b, 0.1);
  return { roof: main.add(bayRoof), gableWalls: mainWalls.add(bayWalls) };
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
  if (w.roof === 'gambrel') return gambrelRoof(w, roofMat);
  if (w.roof === 'saltbox') return saltboxRoof(w, roofMat);
  if (w.roof === 'mansard') return mansardRoof(w, roofMat);
  if (w.roof === 'cross_gable') return crossGableRoof(w, roofMat);
  const s = wingRoofStyle(w, style);
  const ridge = ridgeAxisOf(w);
  const { eave, verge } = overhangOf(roofMat);
  const sprocket = (pitch: number, halfSpan: number) => sprocketFor(pitch, halfSpan, eave);
  const wallRise = pitchOf(w) * (crossSpan(top, ridge) / 2);   // ridge height above wall top

  if (s === 'gable') {
    const { drop, rePitch } = sprocket(pitchOf(w), crossSpan(top, ridge) / 2);
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
  const span = crossSpan(top, ridgeAxisOf(w));
  if (w.roof === 'shed') return SHED_SLOPE * span;
  if (w.roof === 'saltbox') return GABLE_PITCH * SALTBOX_RIDGE_T * span;
  if (w.roof === 'mansard') return MANSARD_RISE_K * (span / 2);
  // gambrel/cross_gable share the gable ridge height by construction.
  const s = wingRoofStyle(w, style);
  const pitch = s === 'hip' ? HIP_PITCH : pitchOf(w);
  return pitch * (span / 2);
}

/** Fraction ACROSS the span where a wing's ridge line sits (saltbox is asymmetric). */
function ridgeCrossT(w: Wing): number {
  return w.roof === 'saltbox' ? SALTBOX_RIDGE_T : 0.5;
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
    // A steeple: a slender stone shaft, rising tall above the ridge to its conical point.
    case 'spire':     return { cw: v.width ?? 0.6, protrude: v.height ?? 2.4, mat: 'stone' };
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

  // A spire/steeple CROWNS the ridge — centred on it (no beside-the-beam offset), a slender
  // stone shaft rising from the wall top past the ridge to a pointed conical cap. The
  // axis-mundi vertical marker of a sacred building, placed at fraction `t` along the ridge
  // (the sanctum end). Anchored at its tip for a future finial/cross.
  if (kind === 'spire') {
    // A wide shaft is a WEST TOWER (grounded from z=0, rising past the ridge to a broach spire);
    // a thin one is a ridge flèche (from the eave). Centred on the ridge cross-axis, at `t` along
    // it — and CLAMPED so the tower stays within the gable footprint, never poking past the wall.
    const tower = cw >= 1.0;
    const half = cw / 2;
    // A west tower stands on the ENTRANCE GABLE: when the vent names a gable face (one
    // perpendicular to the ridge), snap the along-position to that end (t≈0.85/0.15) so the
    // tower is over the door, whichever way the ridge runs; else fall back to v.t.
    const gableT = (pos: 'south' | 'north' | 'east' | 'west' | undefined): number => {
      if (ridge === 'y' && pos === 'south') return 0.85;
      if (ridge === 'y' && pos === 'north') return 0.15;
      if (ridge === 'x' && pos === 'east') return 0.85;
      if (ridge === 'x' && pos === 'west') return 0.15;
      return v.t;
    };
    const tA = gableT(v.face);
    const alongClamp = (o: number, run: number) => Math.min(o + run - half, Math.max(o + half, o + tA * run));
    const scx = ridge === 'x' ? alongClamp(top.x, top.w) : top.x + ridgeCrossT(w) * top.w;
    const scy = ridge === 'x' ? top.y + ridgeCrossT(w) * top.h : alongClamp(top.y, top.h);
    const baseZ = tower ? 0 : wallTop;
    const shaftTop = wallTop + rise + protrude * (tower ? 0.7 : 0.45);   // clears the ridge
    const capH = protrude * 0.6 + 0.4;                    // tall pointed broach cap
    let solid = await solidBox([scx - half, scy - half, baseZ], [cw, cw, shaftTop - baseZ]);
    // A 4-sided PYRAMID broach spire covering the square shaft top — flush to the walls (a
    // round cone would leave the four corners of a masonry tower poking up as a bucket rim).
    solid = solid.add(await solidPyramid([scx, scy], shaftTop, half, half, capH));
    return { solid, anchor: [scx, scy, shaftTop + capH], mat };
  }

  const camRun = (1 - ridgeCrossT(w)) * crossSpan(top, ridge);   // ridge → camera-facing eave
  // Across-ridge offset: clear the ridge line by the vent half-width + a gap, but stay
  // on the slope (cap to ~55% of the camera-side run).
  const off = Math.min(cw / 2 + 0.08, camRun * 0.55);
  // Offset toward +cross (the camera-facing front slope: +y=south for an x-ridge,
  // +x=east for a y-ridge) so the visible side carries the stack.
  const cx = ridge === 'x' ? top.x + v.t * top.w : top.x + ridgeCrossT(w) * top.w + off;
  const cy = ridge === 'x' ? top.y + ridgeCrossT(w) * top.h + off : top.y + v.t * top.h;
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
 * A front-gabled ("doghouse") dormer riding a wing's roof slope at fraction `t`
 * along the ridge: a compact wall-material body that pokes PROUD of the slope,
 * capped by a mini gable prism (roof material) whose ridge runs down-slope. The
 * img2img pass paints the dormer's window; geometry only supplies the massing.
 *
 * The body is sized so its VISIBLE face is a constant height whatever the pitch:
 * a steeper roof gets a DEEPER footprint (the slope climbs `rise·dep/run`), and
 * the body base sinks well below the slope so the dormer always fuses into the
 * roof solid. The old model was a fixed-z horizontal slab spanning ridge→eave —
 * on a steep roof it buried at the ridge and FLOATED a void over the eave, which
 * read as an L-shaped pit punched into the roof rather than a raised dormer.
 */
async function dormerSolids(
  w: Wing, d: DormerFeature, style: RoofStyle,
): Promise<{ box: Manifold; cap: Manifold; recess: Manifold; glass: Manifold; bars: Manifold[] } | null> {
  const top = storeyRect(w, (w.storeys ?? 1) - 1);
  const wallTop = (w.storeys ?? 1) * (w.storeyHeight ?? STOREY);
  const rise = roofRise(w, style);
  if (w.roof === 'flat' || rise <= 0.5) return null;
  const ridge = ridgeAxisOf(w);
  const span = ridge === 'x' ? top.h : top.w;          // across-ridge span
  const camRun = (1 - ridgeCrossT(w)) * span;          // ridge → eave, camera slope
  const dw = d.width ?? 0.5;                            // width along the ridge

  const faceH = 0.6;                                    // visible window-wall height
  // Footprint depth: enough that the slope climbs ~faceH across it, so the back edge
  // buries flush while the front pokes proud. Clamped so it can't span the whole slope.
  const dep = Math.min(0.9 * camRun, (faceH * camRun) / rise);
  const uFront = Math.min(camRun - 0.06, 0.5 * camRun + dep / 2);   // run-from-ridge, front
  const uBack = Math.max(0.06, uFront - dep);
  const zAt = (u: number) => wallTop + rise * (1 - u / camRun);     // slope height at run u
  const zFront = zAt(uFront);
  const baseZ = zFront - 0.8;                           // sink the body below the slope — no void
  const capBase = zFront + faceH;                       // gable sits on the body's flat top
  const along = ridge === 'x' ? top.x + d.t * top.w : top.y + d.t * top.h;

  let at: Vec3, size: Vec3, capRect: WingRect;
  if (ridge === 'x') {
    // dormer faces the +y (south) slope; footprint runs down-slope in +y
    const yBack = top.y + ridgeCrossT(w) * top.h + uBack;
    at = [along - dw / 2, yBack, baseZ];
    size = [dw, uFront - uBack, capBase - baseZ];
    capRect = { x: along - dw / 2, y: yBack, w: dw, h: uFront - uBack };
  } else {
    // dormer faces the +x (east) slope; footprint runs down-slope in +x
    const xBack = top.x + ridgeCrossT(w) * top.w + uBack;
    at = [xBack, along - dw / 2, baseZ];
    size = [uFront - uBack, dw, capBase - baseZ];
    capRect = { x: xBack, y: along - dw / 2, w: uFront - uBack, h: dw };
  }
  const box = await solidBox(at, size);
  const cap = await gablePrism(capRect, ridge === 'x' ? 'y' : 'x', GABLE_PITCH * 0.8, capBase);

  // A recessed window on the dormer's camera-facing front face — REAL geometry, matching the
  // wall windows: a dark glazed pane set into a shallow recess with a timber mullion cross.
  // (The img2img pass that used to paint the dormer light is frozen, so it must be modelled.)
  const winH = faceH * 0.6, winHalf = dw * 0.3;              // fits under the gable cap, inset from the sides
  const zSill = zFront + faceH * 0.22, zMid = zSill + winH / 2;
  const WREC = 0.13, GLASS_T = 0.04, BAR = 0.025, BO = 0.05; // recess depth, pane thickness, bar half-width/proud
  let recess: Manifold, glass: Manifold;
  const bars: Manifold[] = [];
  if (ridge === 'x') {
    const yF = at[1] + size[1];                             // +y (south) front face
    recess = await solidBox([along - winHalf, yF - WREC, zSill], [2 * winHalf, WREC + 0.03, winH]);
    glass = await solidBox([along - winHalf, yF - WREC, zSill], [2 * winHalf, GLASS_T, winH]);
    const bz = yF - WREC + GLASS_T;                         // bars sit just proud of the glass
    bars.push(await solidBox([along - BAR, bz, zSill], [2 * BAR, BO, winH]));                    // mullion
    bars.push(await solidBox([along - winHalf, bz, zMid - BAR], [2 * winHalf, BO, 2 * BAR]));    // transom
  } else {
    const xF = at[0] + size[0];                             // +x (east) front face
    recess = await solidBox([xF - WREC, along - winHalf, zSill], [WREC + 0.03, 2 * winHalf, winH]);
    glass = await solidBox([xF - WREC, along - winHalf, zSill], [GLASS_T, 2 * winHalf, winH]);
    const bz = xF - WREC + GLASS_T;
    bars.push(await solidBox([bz, along - BAR, zSill], [BO, 2 * BAR, winH]));
    bars.push(await solidBox([bz, along - winHalf, zMid - BAR], [BO, 2 * winHalf, 2 * BAR]));
  }
  return { box, cap, recess, glass, bars };
}

export async function buildingFacets(
  wings: Wing[],
  wallMat: Mat = 'plaster',
  roofMat: Mat = 'tile',
  roofStyle: RoofStyle = 'gable',
  features: BuildingFeatures = {},
  seed = 0,
  apertures: ApertureBox[] = [],
  wallWork?: string,
  // L3b cellars/undercroft: a stone base course of this height (tiles) at the wall foot, the
  // rest of the wall in `wallMat`. >0 ⇒ the body reads as a stone undercroft carrying a
  // (timber) upper — the burgage townhouse. 0 ⇒ a single wall material as before.
  baseCourse = 0,
  // Interior epic I-1: a CUTAWAY — omit the roof + roof features and expose a floor slab, so
  // the inside is visible. The geometry foundation the interior reveal (I-2) swaps in on focus.
  cutaway = false,
  // Interior epic I-3: a connectome-derived interior plan — partition walls (fractions along
  // the long axis) + a funnel floor (per-segment downward drop) + per-partition `screens`
  // (Law 4: the threshold into a sanctum is a pierced rood SCREEN, not a solid wall). Only
  // used in the cutaway; absent ⇒ the cutaway is a single open shell with a flat floor (I-2).
  interior?: { partitions: number[]; floorDrop: number[]; screens?: boolean[]; levels?: number[] },
  // Surface FINISHES (paint layer over the material): applied to the wall facets
  // (limewash/ochre/…) and roof facets separately; a stone base course stays bare
  // (the undercroft reads as raw masonry under a washed upper). Vents keep bare.
  finishes?: { wall?: string; roof?: string; tint?: RGB },
): Promise<{ facets: WorldFacet[]; anchors: BuildingAnchors }> {
  const wallFin = finishes?.wall, roofFin = finishes?.roof, finTint = finishes?.tint;
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
  const dormerRecess: Manifold[] = [], dormerGlass: Manifold[] = [], dormerBars: Manifold[] = [];
  for (const d of dormers) {
    const w = wings[d.wing] ?? wings[0];
    const c = await dormerSolids(w, d, roofStyle);
    if (!c) continue;
    dormerBoxes.push(c.box);
    roof = roof.add(c.cap);
    if (!cutaway) { dormerRecess.push(c.recess); dormerGlass.push(c.glass); dormerBars.push(...c.bars); }
  }

  let wallSolid = dormerBoxes.length ? walls.add(Manifold.union(dormerBoxes)) : walls;
  if (dormerRecess.length) wallSolid = wallSolid.subtract(Manifold.union(dormerRecess));
  // Split the wall into a stone undercroft band + the upper wall material when asked; else
  // one material. The boolean clips the band to the actual wall solid, so an oversized base
  // box is safe (the ground storey is un-jettied, so a wings-bbox cover is exact at z=0).
  let wallFacets: WorldFacet[];
  if (baseCourse > 0) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const w of wings) {
      if (w.x < minX) minX = w.x; if (w.y < minY) minY = w.y;
      if (w.x + w.w > maxX) maxX = w.x + w.w; if (w.y + w.h > maxY) maxY = w.y + w.h;
    }
    const baseBox = await solidBox([minX - 1, minY - 1, 0], [maxX - minX + 2, maxY - minY + 2, baseCourse]);
    wallFacets = [
      ...manifoldToFacets(wallSolid.intersect(baseBox).getMesh(), 'stone', wallWork),   // undercroft stays bare
      ...manifoldToFacets(wallSolid.subtract(baseBox).getMesh(), wallMat, wallWork, undefined, wallFin, finTint),
    ];
  } else {
    wallFacets = manifoldToFacets(wallSolid.getMesh(), wallMat, wallWork, undefined, wallFin, finTint);
  }
  // Dormer window glazing + mullions (recesses already carved into the wall solid above).
  if (dormerGlass.length) wallFacets.push(...manifoldToFacets(Manifold.union(dormerGlass).getMesh(), 'glass'));
  if (dormerBars.length) wallFacets.push(...manifoldToFacets(Manifold.union(dormerBars).getMesh(), 'timber'));

  // Cutaway (dollhouse): the building's SOLID massing is hollowed into a wall shell, the
  // roof/dormers/vents are dropped, and the camera-facing walls (+x east, +y south — the iso
  // camera sits at (1,1,1)) are cut to a low sill so the interior is open to view. With an
  // interior plan (I-3) the cavity is divided into rooms by partition walls along the LONG
  // axis, and a worship procession's floor sinks toward the sanctum (the funnel); without
  // one it's a single open room with a flat floor (I-2).
  if (cutaway) {
    let fx0 = Infinity, fy0 = Infinity, fx1 = -Infinity, fy1 = -Infinity;
    for (const w of wings) {
      if (w.x < fx0) fx0 = w.x; if (w.y < fy0) fy0 = w.y;
      if (w.x + w.w > fx1) fx1 = w.x + w.w; if (w.y + w.h > fy1) fy1 = w.y + w.h;
    }
    const W = fx1 - fx0, H = fy1 - fy0;
    const storeyH = wings[0]?.storeyHeight ?? STOREY;
    const nStoreys = Math.max(...wings.map(w => w.storeys ?? 1));
    const tall = storeyH * nStoreys + 5;          // taller than any wall — clears the whole interior
    const FLOOR_T = 0.08, WALL_T = 0.3, SILL = 0.5;
    // Sub-grade depth: a cellar/crypt is a normal-height storey even under a building with a
    // LOFTY one (a sacred 4.5 m nave shouldn't dig a deep pit) — cap it at a plain storey.
    const subH = Math.min(storeyH, STOREY);
    const levelZ = (lvl: number) => lvl * (lvl < 0 ? subH : storeyH);
    // A below-grade cellar (a level:-1 zone) digs the cavity + near-wall cuts down to its floor
    // so it reads in the dollhouse; without one, cellarZ = 0 and the bytes match I-3 exactly.
    const cellarZ = levelZ(Math.min(0, ...(interior?.levels ?? [0])));
    const cavBot = Math.min(-2, cellarZ - 2);
    const cutBot = cellarZ < 0 ? cellarZ : SILL; // ground sill normally; dig past it for a cellar
    // Hollow the solid massing: subtract an inset cavity (open all the way down so we add our
    // own floor) → a wall shell carrying the carved apertures. Then cut the two near walls.
    const cavity = await solidBox([fx0 + WALL_T, fy0 + WALL_T, cavBot], [W - 2 * WALL_T, H - 2 * WALL_T, tall - cavBot]);
    const eastCut = await solidBox([fx1 - WALL_T - 0.02, fy0 - 1, cutBot], [WALL_T + 1.02, H + 2, tall - cutBot]);
    const southCut = await solidBox([fx0 - 1, fy1 - WALL_T - 0.02, cutBot], [W + 2, WALL_T + 1.02, tall - cutBot]);
    const shell = wallSolid.subtract(cavity).subtract(eastCut).subtract(southCut);
    const facets: WorldFacet[] = [...manifoldToFacets(shell.getMesh(), wallMat, wallWork, undefined, wallFin, finTint)];

    const parts = interior?.partitions ?? [];
    const drops = interior?.floorDrop ?? [0];
    const alongX = W >= H;
    const long0 = alongX ? fx0 : fy0, longLen = alongX ? W : H;
    const partH = Math.min(storeyH * 0.66, 1.3);  // low enough to see over from the iso angle
    const PT = 0.18;
    // Floor: one slab per room segment, its top sunk by the segment's funnel drop.
    const bounds = [0, ...parts, 1].map((f) => long0 + f * longLen);
    for (let i = 0; i < bounds.length - 1; i++) {
      const drop = drops[i] ?? 0;
      const s0 = bounds[i], segLen = bounds[i + 1] - bounds[i];
      const slab = alongX
        ? await solidBox([s0, fy0, -drop - FLOOR_T], [segLen, H, FLOOR_T])
        : await solidBox([fx0, s0, -drop - FLOOR_T], [W, segLen, FLOOR_T]);
      facets.push(...manifoldToFacets(slab.getMesh(), 'stone'));
    }
    // Partition walls divide the cavity, rising from the LOWER of the two adjoining floors.
    // A `screens[i]` partition is a permeable rood SCREEN (Law 4) — a low solid dado, slender
    // balusters with see-through gaps, and a head beam (the loft) — rather than a solid wall.
    const screens = interior?.screens ?? [];
    const crossLen = (alongX ? H : W) - 2 * WALL_T;
    const cross0 = (alongX ? fy0 : fx0) + WALL_T;
    // A box of cross-axis span [cAt, cLen] and vertical span [z0, zLen] at the partition line.
    const partBox = (cAt: number, cLen: number, z0: number, zLen: number, at: number) =>
      alongX
        ? solidBox([at - PT / 2, cAt, z0], [PT, cLen, zLen])
        : solidBox([cAt, at - PT / 2, z0], [cLen, PT, zLen]);
    for (let i = 0; i < parts.length; i++) {
      const at = long0 + parts[i] * longLen;
      const base = -Math.max(drops[i] ?? 0, drops[i + 1] ?? 0) - FLOOR_T;
      if (screens[i]) {
        const dadoH = Math.min(0.35, (partH - base) * 0.4); // solid lower panel
        const beamT = 0.16;                                  // head beam / loft
        facets.push(...manifoldToFacets((await partBox(cross0, crossLen, base, dadoH, at)).getMesh(), wallMat, wallWork));
        facets.push(...manifoldToFacets((await partBox(cross0, crossLen, partH - beamT, beamT, at)).getMesh(), wallMat, wallWork));
        const nBal = Math.max(3, Math.round(crossLen / 0.5)); // one slender baluster per ~0.5 tile
        const BW = 0.09, balZ0 = base + dadoH, balH = partH - beamT - balZ0;
        for (let k = 0; k < nBal && balH > 0; k++) {
          const c = cross0 + (k + 0.5) * (crossLen / nBal) - BW / 2;
          facets.push(...manifoldToFacets((await partBox(c, BW, balZ0, balH, at)).getMesh(), wallMat, wallWork));
        }
      } else {
        facets.push(...manifoldToFacets((await partBox(cross0, crossLen, base, partH - base, at)).getMesh(), wallMat, wallWork));
      }
    }
    // Vertical floor plates (the stacked-storey half of I-3): one slab per non-ground level so a
    // tower/keep reads as stacked rooms; a negative level is a below-grade cellar floor (the
    // cavity + near-wall cuts above already dug down to meet it). Level 0 is the ground slab.
    for (const lvl of interior?.levels ?? []) {
      const plate = await solidBox([fx0 + WALL_T, fy0 + WALL_T, levelZ(lvl) - FLOOR_T], [W - 2 * WALL_T, H - 2 * WALL_T, FLOOR_T]);
      facets.push(...manifoldToFacets(plate.getMesh(), 'stone'));
    }
    return { facets, anchors: { vents: [] } };
  }

  const facets: WorldFacet[] = [
    ...wallFacets,
    ...manifoldToFacets(roof.getMesh(), roofMat, undefined, undefined, roofFin, finTint),
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
