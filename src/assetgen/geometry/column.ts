// src/assetgen/geometry/column.ts
// The kit's Column generator — ONE parametric vertical support, consumed as pier /
// post / shaft / baluster / colonnade-member by both buildings and the world
// connectome. A column is a base block + a (optionally tapered) shaft + a capital
// block; pairing it with the Arch primitive (arch.ts) yields an arcade. Today the
// bridge `pier` fakes batter with a non-tapering prism (solids.ts comment admits it);
// this generator makes the taper real and gives every other support one definition.
//
// Authored in cube-units (1 unit = 2 m), like every other solid. Round shafts get a
// cylindrical UV unwrap (KU) via `columnProjector`; square/polygon shafts fall back to
// the normal-derived planar frame the texturer already supplies for flat faces.
import type { Manifold } from 'manifold-3d';
import type { Vec2 } from '@/assetgen/types';
import { getManifold, CIRCULAR_SEGMENTS } from '@/assetgen/geometry/manifold-runtime';
import { cylindricalProjector, type FacetProjector } from '@/assetgen/geometry/solids';

export type ColumnShape = 'round' | 'square' | 'polygon';

/** A base (plinth) or capital (abacus) band: how tall it is and how far it juts past
 *  the shaft half-width at that end. Both in cube-units. */
export interface ColumnBand { heightU: number; oversizeU: number }

export interface ColumnOpts {
  /** Foot of the column. Default 0. */
  baseZ?: number;
  /** Cross-section of the shaft. Default `round`. */
  shape?: ColumnShape;
  /** Sides for `polygon` shape (≥3). Ignored otherwise. */
  sides?: number;
  /** Shaft half-width (round: radius) at the BOTTOM, cube-units. */
  radiusU: number;
  /** Shaft half-width at the TOP; default = `radiusU` (no diminution). Smaller = a
   *  classical taper / structural batter; larger = a corbelled flare. */
  topRadiusU?: number;
  /** Total height (base + shaft + capital) in cube-units. */
  heightU: number;
  /** Plinth at the foot, or null/omit for none. */
  base?: ColumnBand | null;
  /** Capital/abacus at the head, or null/omit for none. */
  capital?: ColumnBand | null;
}

// A regular n-gon's circumradius equals its half-width times this; a 4-gon (square)
// is authored by its half-width, so scale the manifold radius up by √2 and yaw 45°
// so the flats — not the corners — face the axes.
const SQRT2 = Math.SQRT2;

/** A vertical frustum (rLow → rHigh over `height`) of the requested cross-section,
 *  base centred at (cx,cy,baseZ). Square is a 45°-yawed 4-gon so faces are axis-aligned. */
async function frustum(
  cx: number, cy: number, baseZ: number,
  rLow: number, rHigh: number, height: number, shape: ColumnShape, sides: number,
): Promise<Manifold> {
  const { Manifold } = await getManifold();
  if (shape === 'square') {
    return Manifold.cylinder(height, rLow * SQRT2, rHigh * SQRT2, 4)
      .rotate([0, 0, 45]).translate([cx, cy, baseZ]);
  }
  const seg = shape === 'polygon' ? Math.max(3, Math.round(sides)) : CIRCULAR_SEGMENTS;
  return Manifold.cylinder(height, rLow, rHigh, seg).translate([cx, cy, baseZ]);
}

/** A square plinth/abacus block of the given half-width, centred on the column axis. */
async function block(cx: number, cy: number, baseZ: number, halfW: number, height: number): Promise<Manifold> {
  const { Manifold } = await getManifold();
  return Manifold.cube([halfW * 2, halfW * 2, height]).translate([cx - halfW, cy - halfW, baseZ]);
}

/**
 * One column as a unioned solid: optional plinth, a (possibly tapered) shaft, optional
 * abacus. `center` is the axis in tile XY. Heights consume the total `heightU` from the
 * bottom up (base, then shaft, then capital), so a column always stands exactly `heightU`.
 */
export async function solidColumn(center: Vec2, opts: ColumnOpts): Promise<Manifold> {
  const { Manifold } = await getManifold();
  const [cx, cy] = center;
  const baseZ = opts.baseZ ?? 0;
  const shape = opts.shape ?? 'round';
  const sides = opts.sides ?? 8;
  const rLow = opts.radiusU;
  const rHigh = opts.topRadiusU ?? opts.radiusU;
  const baseH = opts.base?.heightU ?? 0;
  const capH = opts.capital?.heightU ?? 0;
  const shaftH = Math.max(0.01, opts.heightU - baseH - capH);

  const solids: Manifold[] = [];
  if (opts.base) solids.push(await block(cx, cy, baseZ, rLow + opts.base.oversizeU, baseH));
  solids.push(await frustum(cx, cy, baseZ + baseH, rLow, rHigh, shaftH, shape, sides));
  if (opts.capital) solids.push(await block(cx, cy, baseZ + baseH + shaftH, rHigh + opts.capital.oversizeU, capH));
  return solids.length === 1 ? solids[0] : Manifold.union(solids);
}

/** UV projector for a column of this shape: round shafts unwrap cylindrically about the
 *  axis (seamless courses); square/polygon shafts use the default planar (normal-derived)
 *  frame. The radius passed is the shaft's widest (bottom) — close enough for the wrap. */
export function columnProjector(center: Vec2, opts: ColumnOpts): FacetProjector | undefined {
  return (opts.shape ?? 'round') === 'round'
    ? cylindricalProjector(center, opts.radiusU)
    : undefined;
}
