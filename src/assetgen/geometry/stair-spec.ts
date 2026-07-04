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
  /** Masonry coursing (`ashlar`/…) — match the curtain the flight climbs so it reads as built
   *  masonry, not a rubble cairn. Absent → bare stone (legacy). */
  work?: string;
}

/** Build a straight stone flight climbing to `walkZ`, its foot at world (cx,cy). Reads as a solid
 *  coursed stair: a continuous ramp stringer under GENEROUS treads (each a full-height block to its
 *  going), so at game zoom it is unmistakably a flight — not the old ~0.2-tile rubble steps. */
export function stairSpec(opts: StairOpts, cx = 0, cy = 0): StairSpec {
  const mat: Mat = opts.material ?? 'stone';
  const work = opts.work;
  const [dx, dy] = opts.dir;
  const [ix, iy] = opts.inward;
  const yaw = (Math.atan2(dy, dx) * 180) / Math.PI;    // box yaw is about its own centre
  const target = Math.max(mToTiles(1.0), opts.walkZ);
  const rise = mToTiles(0.7);                           // step rise (~1.4 m) — fewer, chunkier steps
  const tread = mToTiles(0.62);                         // step going (~1.25 m inward depth per step)
  const width = mToTiles(1.7);                          // flight width along the wall
  const n = Math.max(2, Math.ceil(target / rise));
  const topInset = opts.thickness / 2;                 // top step meets the inner wall face
  const box = (ax: number, ay: number, w: number, d: number, h: number): Part =>
    ({ prim: 'box', at: [ax, ay, 0], size: [w, d, h], material: mat, yaw, ...(work ? { work } : {}) });

  const parts: Part[] = [];
  const runDepth = topInset + n * tread;               // total inward footprint of the flight
  // Solid stringer ramp: a continuous half-height mass under the whole flight so the steps sit on a
  // built stair, not floating stones. Centred over the run, from grade up to ~half the climb.
  const rampMid = topInset + runDepth / 2 - tread / 2;
  parts.push(box(cx + ix * rampMid - width / 2, cy + iy * rampMid - runDepth / 2, width, runDepth, target * 0.5));
  for (let i = 0; i < n; i++) {
    const z = (i + 1) * (target / n);                  // this step's top height
    // Bottom step (i=0) sits FARTHEST inward; the flight climbs toward the wall, top step at it.
    const dist = topInset + (n - 1 - i) * tread;
    const sx = cx + ix * dist, sy = cy + iy * dist;    // step centre (world)
    parts.push(box(sx - width / 2, sy - tread / 2, width, tread, z));
  }
  return { parts, mountAnchors: [{ kind: 'lintel', x: cx, y: cy, facing: [0, 0], z: 0 }] };
}
