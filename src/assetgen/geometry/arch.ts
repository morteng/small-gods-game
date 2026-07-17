// src/assetgen/geometry/arch.ts
//
// The kit's first TRUE curved primitive. Until now every "arch" in the game was a
// square: `solidArch` is a post-and-lintel portal (two cube legs + a beam), and
// aperture heads are rectangular subtraction boxes. This builds a real arch RING —
// a spandrel block with a style-dependent intrados (the inner opening) curve
// subtracted — so bridges, aqueduct arcades and (via the cutter mode) arched
// doors/windows get a genuine curve.
//
// Construction mirrors the roof solids' idiom: author a 2D profile in (u, z) — u =
// across-span, z = up — then `Manifold.extrude(profile, depth).rotate([90,0,0])`
// stands it up and runs it `depth` along the travel axis (+y), exactly like
// `extrudeAlongRidge`'s ridge==='y' branch. The masonry = the spandrel rectangle
// MINUS the opening, so haunch fill above the springing reads as real spandrel walls.

import type { Vec3, SurfaceFrame } from '@/assetgen/types';
import type { Manifold } from 'manifold-3d';
import type { FacetProjector } from '@/assetgen/geometry/solids';
import { getManifold } from '@/assetgen/geometry/manifold-runtime';
import { solidArch } from '@/assetgen/geometry/solids';

/** Arch head profiles. `flat` keeps the historic post-and-lintel portal (parity for
 *  presets that haven't migrated). The rest are genuine curves:
 *   - round/segmental/horseshoe — one half-ellipse (width = span, height = rise); the
 *     three differ only by the rise the caller passes (round ⇒ rise = span/2).
 *   - pointed — two circular arcs meeting at a central apex (gothic). */
export type ArchStyle = 'flat' | 'round' | 'segmental' | 'pointed' | 'horseshoe';

export interface ArchOpts {
  style?: ArchStyle;
  /** Masonry depth above the intrados crown (cube-units; 1 = 2 m). Default 0.35. */
  ringDepth?: number;
  /** Vertical jamb height below the springing line (cube-units). Default 0 — a
   *  bridge/aqueduct arch springs straight from its pier tops. */
  springZ?: number;
  /** Degrees about Z at the springing origin (at.x, at.y), like `solidArch.yaw`. */
  yaw?: number;
  /** Open RIB instead of a filled spandrel: only the curved band between the intrados
   *  and an outer curve one ringDepth out (a timber moon-bridge rib, an exposed arcade
   *  rib). Default false — the filled spandrel wall every existing caller gets. */
  open?: boolean;
}

/** Arc tessellation across the span — enough for a smooth curve, few enough to keep
 *  the facet count modest (a viaduct can be a dozen of these). */
const ARC_SEGMENTS = 20;

/** Intrados (opening) height at horizontal position u∈[0,span] for a style. */
function intradosZ(style: ArchStyle, u: number, span: number, rise: number, springZ: number): number {
  const half = span / 2;
  if (style === 'pointed') {
    // Two arcs of radius = span, each centred at the OPPOSITE springing point. The
    // natural apex for that radius is the equilateral height span·√3/2; scale to `rise`.
    const natural = span * (Math.sqrt(3) / 2) || 1;
    const center = u <= half ? span : 0;   // left half ← right spring; right half ← left spring
    const dx = u - center;
    const z = Math.sqrt(Math.max(0, span * span - dx * dx));
    return springZ + z * (rise / natural);
  }
  // round / segmental / horseshoe: half-ellipse, width = span, height = rise.
  const x = (u - half) / half;             // -1 … +1
  return springZ + rise * Math.sqrt(Math.max(0, 1 - x * x));
}

/** Drop consecutive duplicate points (Manifold's polygon triangulation dislikes them,
 *  which springZ=0 introduces at the jamb corners). */
function dedupe(poly: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (const p of poly) {
    const last = out[out.length - 1];
    if (!last || Math.abs(last[0] - p[0]) > 1e-6 || Math.abs(last[1] - p[1]) > 1e-6) out.push(p);
  }
  return out;
}

/** Reverse to CCW (positive signed area) if needed — `Manifold.extrude` inverts the
 *  solid for CW input (the bug that silently dropped roof slopes; see slabProfile). */
function ensureCCW(poly: [number, number][]): [number, number][] {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i], [x1, y1] = poly[(i + 1) % poly.length];
    a += x0 * y1 - x1 * y0;
  }
  return a < 0 ? poly.slice().reverse() : poly;
}

/** Stand a (u,z) profile up and run it `depth` along +y, base at `at`. Matches the
 *  roof code's ridge==='y' transform so authored profiles land consistently. */
function extrudeProfileY(M: typeof import('manifold-3d').Manifold, profile: [number, number][], depth: number, at: Vec3, yShift = 0): Manifold {
  return M.extrude(ensureCCW(dedupe(profile)), depth)
    .rotate([90, 0, 0])
    .translate([at[0], at[1] + depth + yShift, at[2]]);
}

/** As extrudeProfileY but the profile's u-axis lands on +y and the run goes along +x
 *  (mirrors the roof code's ridge==='x' transform) — for arch heads on east/west walls. */
function extrudeProfileX(M: typeof import('manifold-3d').Manifold, profile: [number, number][], depth: number, at: Vec3): Manifold {
  return M.extrude(ensureCCW(dedupe(profile)), depth)
    .rotate([90, 0, 90])
    .translate([at[0], at[1], at[2]]);
}

/** A curved head cutter sitting on TOP of a rectangular aperture box, to be subtracted
 *  so a door/window gets an arched head instead of a square one. `box` is the aperture
 *  recess ([at]+[size]); `axis` is the wall-run direction (x = south/north faces,
 *  y = east/west). The head springs at the box top and rises `rise` (round ⇒ rise =
 *  half the opening width). It carries the opening's depth so it bores the same recess. */
export async function archHeadCutter(
  at: Vec3, size: Vec3, axis: 'x' | 'y', style: ArchStyle, rise: number,
): Promise<Manifold> {
  const { Manifold } = await getManifold();
  const eps = 0.05;
  const span = axis === 'x' ? size[0] : size[1];
  const depth = axis === 'x' ? size[1] : size[0];
  const topZ = at[2] + size[2];
  // A pure cap: the intrados arc from springing (z=0) up and back to 0, base dropped
  // `eps` so it overlaps the box top for a clean union.
  const cap: [number, number][] = [[0, -eps]];
  for (let i = 0; i <= ARC_SEGMENTS; i++) {
    const u = (i / ARC_SEGMENTS) * span;
    cap.push([u, intradosZ(style, u, span, rise, 0)]);
  }
  cap.push([span, -eps]);
  return axis === 'x'
    ? extrudeProfileY(Manifold, cap, depth, [at[0], at[1], topZ])
    : extrudeProfileX(Manifold, cap, depth, [at[0], at[1], topZ]);
}

/**
 * A voussoir UV projector for a curved arch ring (KV — "the stone formations arches are
 * built of"). The ring's visible masonry lives on its two FACES (normal dominantly along
 * the ring-depth axis); those facets get a `polar` frame centred on the springing mid-point
 * so the texturer lays radial voussoir wedges instead of horizontal courses. Edges (soffit,
 * extrados, jambs) keep the default planar frame. Only the two cardinal orientations the
 * connectome emits (yaw 0 = spans +x, yaw 90 = spans +y) are coursed; others fall back to
 * planar (safe). `span`/`rise`/`ringDepth`/`springZ` are in cube-units, matching the geometry.
 */
export function archVoussoirProjector(
  at: Vec3, span: number, rise: number, ringDepth: number, springZ: number, yaw = 0,
): FacetProjector | undefined {
  const spanAxis: 'x' | 'y' | null = yaw === 0 ? 'x' : yaw === 90 ? 'y' : null;
  if (!spanAxis) return undefined;
  const meanR = rise + ringDepth / 2;
  // Springing mid-point, accounting for the 90° yaw (which pivots the ring about at.xy).
  const cx = spanAxis === 'x' ? at[0] + span / 2 : at[0];
  const cy = spanAxis === 'x' ? at[1] : at[1] + span / 2;
  const depthIdx = spanAxis === 'x' ? 1 : 0;   // ring depth runs along the OTHER horizontal axis
  // Voussoir ring band: intrados radius = rise (round arch), extrados = rise + ringDepth.
  const frame: SurfaceFrame = {
    kind: 'polar', cx, cy, cz: springZ, meanR, spanAxis,
    ringInner: rise, ringOuter: rise + ringDepth,
  };
  return (_c, n): SurfaceFrame | undefined => {
    const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
    const dom = ax >= ay && ax >= az ? 0 : ay >= az ? 1 : 2;   // dominant normal axis
    return dom === depthIdx ? frame : undefined;               // a face (not soffit/edge) → voussoirs
  };
}

/**
 * A true curved arch ring spanning +x, `depth` along +y. `span` = full footprint
 * width (abutment to abutment), `rise` = intrados crown height above the springing.
 * `flat` delegates to the historic portal so un-migrated presets stay byte-identical.
 */
export async function solidArchCurved(at: Vec3, span: number, rise: number, depth: number, opts: ArchOpts = {}): Promise<Manifold> {
  const style = opts.style ?? 'round';
  if (style === 'flat') return solidArch(at, span, rise, depth, opts.yaw ?? 0);

  const { Manifold } = await getManifold();
  const ringDepth = opts.ringDepth ?? 0.35;
  const springZ = opts.springZ ?? 0;
  const crownZ = springZ + rise + ringDepth;

  if (opts.open) {
    // Open RIB: the band between the intrados and an OUTER intrados evaluated one
    // ringDepth out (span + 2·ringDepth wide, rise + ringDepth tall, same feet) — a
    // normal-ish offset, so the band keeps substance where the curve turns vertical
    // instead of thinning to nothing (a plain vertical offset would). The feet land
    // solid on the springing line.
    const outer = (u: number): number =>
      intradosZ(style, u + ringDepth, span + 2 * ringDepth, rise + ringDepth, springZ);
    const band: [number, number][] = [];
    for (let i = 0; i <= ARC_SEGMENTS; i++) {
      const u = (i / ARC_SEGMENTS) * span;
      band.push([u, Math.max(outer(u), springZ + ringDepth * 0.5)]);
    }
    for (let i = ARC_SEGMENTS; i >= 0; i--) {
      const u = (i / ARC_SEGMENTS) * span;
      band.push([u, i === 0 || i === ARC_SEGMENTS ? 0 : intradosZ(style, u, span, rise, springZ)]);
    }
    let rib = extrudeProfileY(Manifold, band, depth, at);
    if (opts.yaw) {
      rib = rib.translate([-at[0], -at[1], 0]).rotate([0, 0, opts.yaw]).translate([at[0], at[1], 0]);
    }
    return rib;
  }

  // Spandrel block: the full rectangle the masonry occupies.
  const spandrel: [number, number][] = [[0, 0], [span, 0], [span, crownZ], [0, crownZ]];

  // Opening: jambs up to the springing, then the intrados arc across the top.
  const opening: [number, number][] = [[0, 0], [0, springZ]];
  for (let i = 0; i <= ARC_SEGMENTS; i++) {
    const u = (i / ARC_SEGMENTS) * span;
    opening.push([u, intradosZ(style, u, span, rise, springZ)]);
  }
  opening.push([span, springZ], [span, 0]);

  const eps = 0.05;
  const block = extrudeProfileY(Manifold, spandrel, depth, at);
  // Cut slightly past both faces so the opening bores cleanly through the barrel.
  const cutter = extrudeProfileY(Manifold, opening, depth + 2 * eps, at, -eps);
  let arch = block.subtract(cutter);

  if (opts.yaw) {
    arch = arch.translate([-at[0], -at[1], 0]).rotate([0, 0, opts.yaw]).translate([at[0], at[1], 0]);
  }
  return arch;
}
