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

/** Build a straight stone flight climbing to `walkZ`, its foot at world (cx,cy). Reads as a built
 *  coursed stair: every tread is exposed (each a full-height block to grade), a proud nosing lip
 *  beads each step's leading edge (highlight over a shaded riser, so the rhythm reads at game
 *  zoom), coursed stringer cheeks flank the flight for mass, and a plinth seats the foot into the
 *  ground. Coursing + banded lighting do the shading — no lighting is painted into the albedo. */
export function stairSpec(opts: StairOpts, cx = 0, cy = 0): StairSpec {
  const mat: Mat = opts.material ?? 'stone';
  const work = opts.work;
  const cheekWork = mat === 'stone' || mat === 'brick' ? 'ashlar' : work;   // dressed flanks
  const [dx, dy] = opts.dir;
  const [ix, iy] = opts.inward;
  const yaw = (Math.atan2(dy, dx) * 180) / Math.PI;    // box yaw is about its own centre
  const target = Math.max(mToTiles(1.0), opts.walkZ);
  const rise = mToTiles(0.36);                          // step rise (~0.72 m) — a readable mural step
  const tread = mToTiles(0.48);                         // step going (~0.96 m inward depth per step)
  const width = mToTiles(1.7);                          // flight width along the wall
  const cheekW = mToTiles(0.32);                        // flanking stringer width
  const stringerFree = mToTiles(0.16);                 // cheek stands this far proud of each tread
  const noseProj = mToTiles(0.08), noseDrop = mToTiles(0.08), noseRaise = mToTiles(0.02);
  const n = Math.max(3, Math.ceil(target / rise));
  const topInset = opts.thickness / 2;                 // top step meets the inner wall face

  // A box centred at world (cx+dir·u+inward·v), sized `wDir` along the wall × `dInward` inward ×
  // `h` tall from `z0`, yawed with the wall. u/v are the along-wall + inward offsets in tiles.
  const box = (u: number, v: number, wDir: number, dInward: number, z0: number, h: number, wk?: string, src?: string): Part => {
    const px = cx + dx * u + ix * v, py = cy + dy * u + iy * v;
    return { prim: 'box', at: [px - wDir / 2, py - dInward / 2, z0], size: [wDir, dInward, h], material: mat, yaw,
      ...(wk ? { work: wk } : {}), ...(src ? { srcId: src } : {}) };
  };
  // Inward distance of step i's centre. i=0 (shortest) foots FARTHEST inward; the flight climbs
  // toward the wall, so the tallest step (i=n-1) meets the inner face at `topInset`.
  const distOf = (i: number) => topInset + (n - 1 - i) * tread;
  const topOf = (i: number) => (i + 1) * (target / n);

  const parts: Part[] = [];
  // 1. STEPS — a solid coursed block per tread, grade → its tread top.
  for (let i = 0; i < n; i++) parts.push(box(0, distOf(i), width, tread, 0, topOf(i), work, 'stair'));
  // 2. NOSING — a proud lip at each tread's downhill (inward-facing) edge: its top beads the light,
  //    its overhang shades the riser below (AO), so each step separates cleanly.
  for (let i = 0; i < n; i++) {
    const z = topOf(i);
    parts.push(box(0, distOf(i) + tread / 2 + noseProj / 2, width, noseProj, z - noseDrop, noseDrop + noseRaise, work, 'stair/nose'));
  }
  // 3. STRINGER CHEEKS — a coursed flank each side, stepping up with the flight, standing proud of
  //    the treads so the stair has mass instead of floating steps.
  for (const s of [-1, 1]) {
    const u = s * (width / 2 + cheekW / 2);
    for (let i = 0; i < n; i++) parts.push(box(u, distOf(i), cheekW, tread, 0, topOf(i) + stringerFree, cheekWork, 'stair/cheek'));
  }
  // 4. FOOT PLINTH — a low block seating the flight's foot into the ground (spans the cheeks).
  const footProj = mToTiles(0.26), footH = mToTiles(0.32);
  const footV = distOf(0);
  parts.push(box(0, footV + footProj / 2, width + 2 * cheekW, tread + footProj, 0, footH, work, 'stair/foot'));

  return { parts, mountAnchors: [{ kind: 'lintel', x: cx, y: cy, facing: [0, 0], z: 0 }] };
}
