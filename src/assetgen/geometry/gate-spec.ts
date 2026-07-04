// src/assetgen/geometry/gate-spec.ts
// A timber GATE LEAF set in a fortified gateway — the door that closes the opening the
// gatehouse towers flank and the masonry arch spans. Expressed as composeStructure prims so
// it rides the SAME lit pipeline as the curtain/towers and composites into one sprite.
//
// Two braced leaves hang in the passage, each a plank slab with a horizontal ledger band and
// an iron boss, leaving a central reveal — the authentic double-leaf castle gate. Built in the
// gate's own world frame (centred on the opening, yawed to the wall direction) with a base
// mount anchor the source reads to land it on the gate. Pure prim emission.
import type { Part } from '@/assetgen/compose';
import type { Mat } from '@/assetgen/types';
import { mToTiles } from '@/render/scale-contract';
import type { Anchor } from '@/world/anchors';

export interface GateSpec {
  parts: Part[];
  /** z=0 mount anchor at the gateway centre — the source reads its normalised sprite position
   *  to land the leaves exactly in the opening. */
  mountAnchors: Anchor[];
}

export interface GateOpts {
  /** Clear width of the opening, tiles (the gate's `width`). */
  gateWidth: number;
  /** Curtain height the gateway pierces, cube-units — caps the leaf height under the arch. */
  curtainHeight: number;
  /** Wall direction at the gate (unit vector) — the leaves hang along it. */
  dir: [number, number];
  /** Door timber. */
  material?: Mat;
}

/** A timber GATE FRAME for a palisade/timber ring — two heavy jamb posts flanking the opening
 *  plus a lintel beam over it. The masonry ring frames its gate with stone gatehouse towers; a
 *  wooden ring needs this so the gate reads as a built gateway, not a bare gap between stake-ends.
 *  Built in the gate's own world frame; base mount anchor at the opening centre. */
export function gateFrameSpec(opts: GateOpts, cx = 0, cy = 0): GateSpec {
  const mat: Mat = opts.material ?? 'timber';
  const [dx, dy] = opts.dir;
  const yaw = (Math.atan2(dy, dx) * 180) / Math.PI;
  const postW = mToTiles(0.7);                            // heavy squared jamb post
  const postH = opts.curtainHeight + mToTiles(0.9);       // stands proud of the palisade
  const half = opts.gateWidth / 2 + postW / 2;            // jamb centre, just outside the clear opening
  const parts: Part[] = [];
  const jamb = (sign: number): void => {
    const jx = cx + dx * half * sign, jy = cy + dy * half * sign;
    parts.push({ prim: 'box', at: [jx - postW / 2, jy - postW / 2, 0], size: [postW, postW, postH], material: mat, yaw});
  };
  jamb(-1); jamb(+1);
  // Lintel beam across the top, spanning jamb-to-jamb along the wall direction.
  const span = opts.gateWidth + postW * 2;
  const beamH = mToTiles(0.5), beamT = mToTiles(0.5);
  const lz = opts.curtainHeight + mToTiles(0.1);
  parts.push({ prim: 'box', at: [cx - span / 2, cy - beamT / 2, lz], size: [span, beamT, beamH], material: mat, yaw});
  return { parts, mountAnchors: [{ kind: 'lintel', x: cx, y: cy, facing: [0, 0], z: 0 }] };
}

/** Build the closed double-leaf gate centred at world (cx,cy), base at z=0. */
export function gateLeafSpec(opts: GateOpts, cx = 0, cy = 0): GateSpec {
  const mat: Mat = opts.material ?? 'timber';
  const [dx, dy] = opts.dir;
  const yaw = (Math.atan2(dy, dx) * 180) / Math.PI;     // box yaw is about its own centre
  const t = mToTiles(0.32);                              // leaf thickness (passage depth)
  const reveal = mToTiles(0.14);                         // central gap where the leaves meet
  // The leaf rises to the arch spring: a doorway proportion (~1.6×width) but never above the
  // curtain it sits in. Reads as a gate set UNDER the masonry span, not a flush panel.
  const clearH = Math.min(opts.curtainHeight * 0.74, opts.gateWidth * 1.6);
  const leafW = Math.max(mToTiles(0.4), (opts.gateWidth - reveal) / 2);
  // Centre offset of each leaf ALONG the wall (world space): half a leaf out from the reveal.
  const off = leafW / 2 + reveal / 2;
  const ux = dx, uy = dy;                                // along-wall unit
  // The masonry gate cut opens the passage from ~0.6 m BELOW grade (a buried sill), so a leaf that
  // started at z=0 left a dark void under it. Foot the leaf at that sill so it fills the opening to
  // the ground (in-world the terrain occludes the below-grade lip; the harness shows it grounded).
  const footZ = -mToTiles(0.6);
  const slabH = clearH - footZ;                          // leaf spans the sill up to the arch spring

  const parts: Part[] = [];
  const leaf = (sign: number): void => {
    const lx = cx + ux * off * sign, ly = cy + uy * off * sign;   // this leaf's world centre
    // Plank slab.
    parts.push({ prim: 'box', at: [lx - leafW / 2, ly - t / 2, footZ], size: [leafW, t, slabH], material: mat, yaw, work: 'plank' });
    // Two horizontal ledger bands (proud of the planks) — the cross-bracing of a board gate.
    const bandH = mToTiles(0.22), bandT = t + mToTiles(0.1);
    for (const fz of [0.28, 0.72]) {
      const bz = clearH * fz - bandH / 2;
      parts.push({ prim: 'box', at: [lx - leafW / 2, ly - bandT / 2, bz], size: [leafW, bandT, bandH], material: mat, yaw });
    }
  };
  leaf(-1);
  leaf(+1);

  return { parts, mountAnchors: [{ kind: 'lintel', x: cx, y: cy, facing: [0, 0], z: 0 }] };
}
