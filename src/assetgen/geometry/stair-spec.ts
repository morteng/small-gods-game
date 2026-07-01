// src/assetgen/geometry/stair-spec.ts
// A mural STAIR — the stone flight defenders climb from the inner ground up to the wall-walk.
// Expressed as composeStructure prims so it rides the SAME lit pipeline as the curtain/towers and
// composites into one sprite. Built against the INNER face of the wall (a wall is useless if no
// one can man it): a straight flight running ALONG the wall, each step a full-height block from
// grade to its tread so the whole reads as a solid stone stair with a triangular flank — the
// commonest medieval form (mural stairs / stone steps up to the allure). Pure prim emission.
import type { Part } from '@/assetgen/compose';
import type { Mat } from '@/assetgen/types';
import { mToTiles } from '@/render/scale-contract';
import type { Anchor } from '@/world/anchors';

export interface StairSpec {
  parts: Part[];
  /** z=0 mount anchor at the flight's foot (world) — the source reads its normalised sprite
   *  position to land the stair against the wall. */
  mountAnchors: Anchor[];
}

export interface StairOpts {
  /** Height to climb to (cube-units) — the wall-walk level (curtain top). */
  walkZ: number;
  /** Along-wall unit vector — the flight runs parallel to the wall. */
  dir: [number, number];
  /** Inward unit vector (toward the town) — the flight sits on this side, climbing toward the wall. */
  inward: [number, number];
  /** Wall thickness (tiles) — the top step lands at the inner face, half a thickness in. */
  thickness: number;
  material?: Mat;
}

/** Build a straight stone flight climbing to `walkZ`, its foot at world (cx,cy). */
export function stairSpec(opts: StairOpts, cx = 0, cy = 0): StairSpec {
  const mat: Mat = opts.material ?? 'stone';
  const [dx, dy] = opts.dir;
  const [ix, iy] = opts.inward;
  const yaw = (Math.atan2(dy, dx) * 180) / Math.PI;    // box yaw is about its own centre
  const target = Math.max(mToTiles(1.0), opts.walkZ);
  const rise = mToTiles(0.38);                          // step rise (~0.75 m)
  const tread = mToTiles(0.42);                         // step going (inward depth per step)
  const width = mToTiles(1.5);                          // flight width along the wall
  const n = Math.max(2, Math.ceil(target / rise));
  const topInset = opts.thickness / 2;                 // top step meets the inner wall face

  const parts: Part[] = [];
  for (let i = 0; i < n; i++) {
    const z = (i + 1) * (target / n);                  // this step's top height
    // Bottom step (i=0) sits FARTHEST inward; the flight climbs toward the wall, top step at it.
    const dist = topInset + (n - 1 - i) * tread;
    const sx = cx + ix * dist, sy = cy + iy * dist;    // step centre (world)
    // Full-height block from grade to the tread → a solid stepped stair with a triangular flank.
    parts.push({ prim: 'box', at: [sx - width / 2, sy - tread / 2, 0], size: [width, tread, z], material: mat, yaw });
  }
  return { parts, mountAnchors: [{ kind: 'lintel', x: cx, y: cy, facing: [0, 0], z: 0 }] };
}
