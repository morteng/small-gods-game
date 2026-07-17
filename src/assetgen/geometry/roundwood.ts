// src/assetgen/geometry/roundwood.ts
// The kit's HORIZONTAL round timber — a log. The vertical cylinder family (cylinder prim,
// Column) covers posts and piers; nothing in the kit could lay a round member on its side,
// which is why the tier-0 "log" crossing shipped as a plank (a narrow deck BOX). This
// generator is that missing member: a (optionally tapered) cylinder laid along a horizontal
// bearing, with an optional adze-flattened top face — a slab subtracted from the crown in the
// log's OWN frame, so the flat walks with the log through pitch/yaw and NPCs plausibly cross
// it while the sides and end-grain stay round.
//
// Additive: a brand-new solid consumed only by the new `roundwood` prim; no existing prim's
// geometry path is touched (assetgen-golden pins stay byte-identical, no ART bump).
// Authored in the same units as every other solid (tile XY, cube-unit Z; 1 tile = 2 m).
import type { Manifold } from 'manifold-3d';
import { getManifold, CIRCULAR_SEGMENTS } from '@/assetgen/geometry/manifold-runtime';

export interface RoundwoodOpts {
  /** Axis MIDPOINT (tiles; z in cube-units) — the member extends ±length/2 along the bearing,
   *  and pitch/yaw rotate about this point, so a yawed log stays inside its footprint box. */
  center: [number, number, number];
  /** Axis length (tiles). */
  length: number;
  /** Butt-end radius (tiles) — the −x end at yaw 0. */
  radius: number;
  /** Tip-end radius (tiles) — a natural taper. Default = `radius` (no taper). */
  tipRadius?: number;
  /** Bearing °, CCW from +x (the deck/arch yaw convention). Default 0. */
  yawDeg?: number;
  /** Incline °; positive lifts the TIP (+bearing) end. Default 0 (level). */
  pitchDeg?: number;
  /** Adze-flattened top: chord depth cut down from the crown (tiles), in the log's own
   *  frame (pre-pitch/yaw). 0/unset ⇒ fully round. Clamped below the axis so a heavy hand
   *  never halves the log. */
  flatDepth?: number;
}

/** One horizontal round timber as a solid (see module doc). Deterministic. */
export async function solidRoundwood(o: RoundwoodOpts): Promise<Manifold> {
  const { Manifold } = await getManifold();
  const rButt = o.radius;
  const rTip = o.tipRadius ?? o.radius;
  // Manifold.cylinder builds along +z from 0..length (base radius first): recentre on the
  // origin, then lay it along +x (rotate about y by 90° maps +z → +x), so the BUTT (base
  // radius) lands at −x and the TIP at +x.
  let m = Manifold.cylinder(o.length, rButt, rTip, CIRCULAR_SEGMENTS)
    .translate([0, 0, -o.length / 2])
    .rotate([0, 90, 0]);
  const rMax = Math.max(rButt, rTip);
  const flat = Math.min(Math.max(0, o.flatDepth ?? 0), rMax * 0.9);
  if (flat > 0) {
    // The adze flat: subtract a slab over the crown in the log's own frame. Oversized in
    // plan so taper/segment corners never survive the cut.
    const w = o.length + 2 * rMax;
    m = m.subtract(Manifold.cube([w, w, rMax + flat]).translate([-w / 2, -w / 2, rMax - flat]));
  }
  const pitch = o.pitchDeg ?? 0;
  const yaw = o.yawDeg ?? 0;
  // Rotating about y by −pitch lifts the +x (tip) end for positive pitch.
  if (pitch) m = m.rotate([0, -pitch, 0]);
  if (yaw) m = m.rotate([0, 0, yaw]);
  return m.translate([o.center[0], o.center[1], o.center[2]]);
}
