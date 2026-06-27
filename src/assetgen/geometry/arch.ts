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

import type { Vec3 } from '@/assetgen/types';
import type { Manifold } from 'manifold-3d';
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
