// src/assetgen/geometry/tower-spec.ts
// A mural/corner TOWER expressed as composeStructure prims, so it rides the SAME lit pipeline
// as a building/curtain and composites into ONE sprite. A square tower (reads cleanest in iso)
// that rises above the curtain it flanks: a battered base, a shaft, a corbelled machicolation
// band overhanging the face (the projecting gallery defenders dropped through), and a
// crenellated parapet of merlons + crenel embrasures around all four edges — the defining
// "flanking tower" that lets defenders rake the foot of the wall, and the authentic cover over
// a curtain's corner joint. Pure prim emission; the source composes + caches it.
import type { Part } from '@/assetgen/compose';
import type { Mat } from '@/assetgen/types';
import { mToTiles } from '@/render/scale-contract';
import type { Anchor } from '@/world/anchors';

export interface TowerOpts {
  /** Curtain height the tower flanks, cube-units — the tower rises above it. */
  curtainHeight: number;
  /** Curtain thickness, cube-units — the tower projects beyond it. */
  curtainThickness: number;
  material: Mat;
  /** A taller, slimmer keep-like tower (a gate flank) vs a squat corner bastion. */
  tall?: boolean;
}

export interface TowerSpec {
  parts: Part[];
  /** A z=0 mount anchor at the tower's base CENTRE — the source reads its normalised sprite
   *  position to land the tower exactly on the ring corner / gate jamb. */
  mountAnchors: Anchor[];
  /** Tower side (tiles) — the source uses it to inset twin gate towers. */
  side: number;
}

/** Place merlon boxes along one top edge of the square (axis + fixed cross-offset). */
function merlonsAlongEdge(
  axis: 'x' | 'y', fixedCross: number, from: number, to: number,
  z: number, mh: number, mt: number, mat: Mat,
): Part[] {
  const out: Part[] = [];
  const period = mToTiles(1.4), mw = period * 0.55;
  for (let d = from; d + mw <= to + 1e-6; d += period) {
    out.push(axis === 'x'
      ? { prim: 'box', at: [d, fixedCross, z], size: [mw, mt, mh], material: mat }
      : { prim: 'box', at: [fixedCross, d, z], size: [mt, mw, mh], material: mat });
  }
  return out;
}

/** Build a square tower centred at world (cx,cy), base at z=0. */
export function towerSpec(opts: TowerOpts, cx = 0, cy = 0): TowerSpec {
  const mat = opts.material;
  const side = Math.max(mToTiles(2.4), opts.curtainThickness + mToTiles(opts.tall ? 1.4 : 2.0));
  const rise = mToTiles(opts.tall ? 4.0 : 2.4);
  const towerH = opts.curtainHeight + rise;
  const parapetH = mToTiles(1.5);
  const baseH = mToTiles(1.2);
  const flare = mToTiles(0.7);
  const corbel = mToTiles(0.35);              // machicolation overhang
  const corbelH = mToTiles(0.5);
  const walkZ = towerH - parapetH;            // wall-walk / parapet floor
  const h = side / 2;
  const at = (lx: number, ly: number): [number, number] => [cx + lx, cy + ly];

  const parts: Part[] = [];
  // Battered base (flared foot).
  parts.push({ prim: 'box', at: [...at(-h - flare / 2, -h - flare / 2), 0], size: [side + flare, side + flare, baseH], material: mat });
  // Main shaft.
  parts.push({ prim: 'box', at: [...at(-h, -h), baseH * 0.6], size: [side, side, walkZ - baseH * 0.6], material: mat });
  // Corbelled machicolation band — overhangs the shaft just below the parapet.
  const cs = side + 2 * corbel, ch = h + corbel;
  parts.push({ prim: 'box', at: [...at(-ch, -ch), walkZ - corbelH], size: [cs, cs, corbelH], material: mat });
  // Crenellated parapet around all four edges (on the corbel-widened footprint).
  const pt = mToTiles(0.4);
  const lo = -ch, hi = ch - pt;
  parts.push(...merlonsAlongEdge('x', cy + lo, cx - ch, cx + ch, walkZ, parapetH, pt, mat));   // south edge
  parts.push(...merlonsAlongEdge('x', cy + hi, cx - ch, cx + ch, walkZ, parapetH, pt, mat));   // north edge
  parts.push(...merlonsAlongEdge('y', cx + lo, cy - ch, cy + ch, walkZ, parapetH, pt, mat));   // west edge
  parts.push(...merlonsAlongEdge('y', cx + hi, cy - ch, cy + ch, walkZ, parapetH, pt, mat));   // east edge

  return {
    parts,
    mountAnchors: [{ kind: 'lintel', x: cx, y: cy, facing: [0, 0], z: 0 }],
    side,
  };
}
