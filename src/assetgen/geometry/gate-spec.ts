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
import { gateArchProfile } from './linear';

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
  /** The cut is an ARCHED masonry passage (`gateIsArched(run)`) — the leaf fills the arch head
   *  (round-topped door, per the gatehouse TTI reference) instead of stopping flat at a
   *  proportion height and leaving a void under the crown. */
  arch?: boolean;
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
  // The leaf rises to the arch SPRING of the actual cut when the passage is arched (shared
  // profile — cut and door can never disagree), else a doorway proportion under the curtain.
  const prof = opts.arch ? gateArchProfile(opts.curtainHeight, opts.gateWidth) : null;
  const clearH = prof ? prof.springZ : Math.min(opts.curtainHeight * 0.74, opts.gateWidth * 1.6);
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
    // Plank slab — VERTICAL boards (a medieval gate is upright boarding under horizontal ledgers).
    parts.push({ prim: 'box', at: [lx - leafW / 2, ly - t / 2, footZ], size: [leafW, t, slabH], material: mat, yaw, work: 'plank_v' });
    // Two horizontal ledger bands (proud of the planks) — the cross-bracing of a board gate.
    const bandH = mToTiles(0.22), bandT = t + mToTiles(0.1);
    for (const fz of [0.28, 0.72]) {
      const bz = clearH * fz - bandH / 2;
      parts.push({ prim: 'box', at: [lx - leafW / 2, ly - bandT / 2, bz], size: [leafW, bandT, bandH], material: mat, yaw });
    }
  };
  leaf(-1);
  leaf(+1);

  // ARCH HEAD FILL: the door follows the arch (the reference's round-topped leaves) — stacked
  // boards tapering on the cut's own circle, spanning both leaves, from the spring to the crown.
  // Without this the leaf stopped flat at the spring and the arch head gaped as a void.
  if (prof) {
    const { springZ, rise, archR, centreZ } = prof;
    const steps = Math.max(3, Math.ceil(rise / mToTiles(0.28)));
    for (let i = 0; i < steps; i++) {
      const z0 = springZ + (i / steps) * rise;
      const z1 = springZ + ((i + 1) / steps) * rise;
      // Half-width of the arch circle at the TOP of this course (the narrower end) — inset a
      // hair so the boards tuck behind the voussoir ring instead of z-fighting it.
      const dz = z1 - centreZ;
      const hw = Math.max(mToTiles(0.15), Math.sqrt(Math.max(0, archR * archR - dz * dz)) - mToTiles(0.03));
      parts.push({
        prim: 'box',
        at: [cx - hw, cy - t / 2, z0],
        size: [hw * 2, t, (z1 - z0) * 1.04],
        material: mat, yaw, work: 'plank_v',
      });
    }
  }

  return { parts, mountAnchors: [{ kind: 'lintel', x: cx, y: cy, facing: [0, 0], z: 0 }] };
}
