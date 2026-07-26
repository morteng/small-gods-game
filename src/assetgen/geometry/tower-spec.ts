// src/assetgen/geometry/tower-spec.ts
// A mural/corner TOWER expressed as composeStructure prims, so it rides the SAME lit pipeline
// as a building/curtain and composites into ONE sprite. Rises above the curtain it flanks so it
// covers the wall's corner joint and lets defenders rake the foot of the wall.
//
// Two authentic forms (medieval walls mixed them — round drums on the open circuit, square
// gatehouse towers framing the gate):
//   • SQUARE — battered base, shaft, a corbelled machicolation band, a crenellated parapet of
//     merlons + crenels on all four edges. Used (taller, `tall`) to flank a gate.
//   • ROUND (drum) — a battered frustum foot, a cylindrical shaft, a corbel ring, and merlons
//     wrapped around the parapet ring. The classic wall/corner tower.
// Pure prim emission; the source composes + caches it.
import type { Part } from '@/assetgen/compose';
import type { Mat } from '@/assetgen/types';
import type { ApertureBox } from '@/assetgen/geometry/solids';
import { merlonsAroundRect, merlonsAroundRing, ringCourse, parapetHeight, PARAPET_BASE_COURSE_FRAC } from '@/assetgen/geometry/battlement';
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
  /** A round drum tower (the default corner/wall tower) rather than a square one. */
  round?: boolean;
  /** Unit vector toward the town INTERIOR (from the ring centroid). The tower's entrance doorway
   *  faces this way (you enter from inside); arrow-loops face the opposite (field) way. Absent →
   *  a solid tower with no openings (legacy). */
  inward?: [number, number];
  /** Masonry coursing (`ashlar`/`coursed_rubble`/…) the tower paints with — match it to the curtain
   *  it flanks so a wall and its towers read as ONE build (not crazy-paving beside coursed ashlar).
   *  Absent → bare stone (legacy). */
  work?: string;
}

/** Tag every part that carries no coursing yet with the tower's `work`, so drum shafts, corbels
 *  and merlons all match the curtain (the merlon helpers emit bare boxes). Mutates + returns. */
function withWork(parts: Part[], work?: string): Part[] {
  if (work) for (const p of parts) if (!('work' in p) || (p as { work?: string }).work === undefined) (p as { work?: string }).work = work;
  return parts;
}

const EPS = mToTiles(0.05);

/** A drum tower must read as a TOWER, not a fat corner bulge: its height is sized from the
 *  curtain it flanks, then floored so it is at least this much taller than it is wide. Real
 *  drum towers run 2–3; below ~1.5 the silhouette reads as a barrel half-buried in the wall. */
const MIN_TOWER_ASPECT = 1.8;

/** An arched DOORWAY niche recessed into the face the `inward` vector points at — the tower's
 *  entrance. `half` is the distance from centre to that face. A deep dark recess reads as a way
 *  in even though the massing behind stays solid (a true hollow interior needs the cutaway path). */
function doorwayAperture(cx: number, cy: number, half: number, inward: [number, number]): ApertureBox {
  const [ix, iy] = inward;
  const useX = Math.abs(ix) >= Math.abs(iy);
  const sgn = useX ? (ix >= 0 ? 1 : -1) : (iy >= 0 ? 1 : -1);
  const dW = mToTiles(2.2), dH = mToTiles(3.2), depth = mToTiles(2.2);   // a big arched gate-tower door
  const rise = mToTiles(0.7);
  if (useX) {
    const faceX = cx + sgn * half;
    const atX = sgn > 0 ? faceX - depth : faceX - EPS;
    return { at: [atX, cy - dW / 2, -EPS], size: [depth + EPS, dW, dH], arch: { axis: 'y', style: 'round', rise } };
  }
  const faceY = cy + sgn * half;
  const atY = sgn > 0 ? faceY - depth : faceY - EPS;
  return { at: [cx - dW / 2, atY, -EPS], size: [dW, depth + EPS, dH], arch: { axis: 'x', style: 'round', rise } };
}


export interface TowerSpec {
  parts: Part[];
  /** A z=0 mount anchor at the tower's base CENTRE — the source reads its normalised sprite
   *  position to land the tower exactly on the ring corner / gate jamb. */
  mountAnchors: Anchor[];
  /** Tower footprint extent (tiles): the side of a square, the diameter of a drum — the source
   *  uses it to inset twin gate towers. */
  side: number;
}

/** Square mural tower centred at world (cx,cy), base at z=0. */
function squareTower(opts: TowerOpts, cx: number, cy: number): TowerSpec {
  const mat = opts.material;
  const side = Math.max(mToTiles(2.4), opts.curtainThickness + mToTiles(opts.tall ? 1.4 : 2.0));
  // Same rule as the drum: the rise scales with the curtain, then the whole tower is floored by
  // MIN_TOWER_ASPECT. A flat rise left a gate tower on a thick wall 6 m wide and 8.4 m tall
  // (aspect 1.40) — a block astride the wall rather than a tower flanking it.
  const rise = Math.max(mToTiles(opts.tall ? 4.0 : 2.4), opts.curtainHeight * (opts.tall ? 0.75 : 0.5));
  const towerH = Math.max(opts.curtainHeight + rise, side * MIN_TOWER_ASPECT);
  const parapetH = parapetHeight(opts.curtainHeight);
  const baseH = mToTiles(1.2);
  const flare = mToTiles(0.7);
  const corbel = mToTiles(0.35);              // machicolation overhang
  const corbelH = mToTiles(0.5);
  const walkZ = towerH - parapetH;            // wall-walk / parapet floor
  const h = side / 2;
  const at = (lx: number, ly: number): [number, number] => [cx + lx, cy + ly];

  // Entrance doorway on the inner face if the tower knows which way it faces — the way in, so a
  // tower reads as an enterable fighting tower (reached from the mural stairs + wall-walk).
  const door = opts.inward ? doorwayAperture(cx, cy, h, opts.inward) : undefined;
  const baseDoor = opts.inward ? doorwayAperture(cx, cy, h + flare / 2, opts.inward) : undefined;

  const parts: Part[] = [];
  // Battered base (flared foot) — carry the doorway through it so the entrance reaches grade.
  parts.push({ prim: 'box', at: [...at(-h - flare / 2, -h - flare / 2), 0], size: [side + flare, side + flare, baseH], material: mat, ...(baseDoor ? { apertures: [baseDoor] } : {}) });
  // Main shaft — inner doorway.
  parts.push({ prim: 'box', at: [...at(-h, -h), baseH * 0.6], size: [side, side, walkZ - baseH * 0.6], material: mat, ...(door ? { apertures: [door] } : {}) });
  // Corbelled machicolation band — overhangs the shaft just below the parapet.
  const cs = side + 2 * corbel, ch = h + corbel;
  parts.push({ prim: 'box', at: [...at(-ch, -ch), walkZ - corbelH], size: [cs, cs, corbelH], material: mat });
  // Crenellated parapet around all four edges (on the corbel-widened footprint): a low continuous
  // base course (the crenel sill) with corner-anchored, self-tiled teeth standing on it — the same
  // construction the curtain uses, so a wall and its towers read as one build.
  const pt = mToTiles(0.4);
  const x0 = cx - ch, x1 = cx + ch, y0 = cy - ch, y1 = cy + ch;
  const sillH = parapetH * PARAPET_BASE_COURSE_FRAC;
  parts.push(
    { prim: 'box', at: [x0, y0, walkZ], size: [x1 - x0, pt, sillH], material: mat },
    { prim: 'box', at: [x0, y1 - pt, walkZ], size: [x1 - x0, pt, sillH], material: mat },
    { prim: 'box', at: [x0, y0 + pt, walkZ], size: [pt, y1 - y0 - 2 * pt, sillH], material: mat },
    { prim: 'box', at: [x1 - pt, y0 + pt, walkZ], size: [pt, y1 - y0 - 2 * pt, sillH], material: mat },
  );
  // Teeth rise the FULL parapet height from the walk (the sill overlaps behind them) — exactly as
  // the curtain builds it, so tower and wall battlements stand at one height.
  parts.push(...merlonsAroundRect(x0, y0, x1, y1, pt, walkZ, parapetH, mat));

  return { parts: withWork(parts, opts.work), mountAnchors: [{ kind: 'lintel', x: cx, y: cy, facing: [0, 0], z: 0 }], side };
}

/** Round drum tower centred at world (cx,cy), base at z=0. */
function roundTower(opts: TowerOpts, cx: number, cy: number): TowerSpec {
  const mat = opts.material;
  // A corner drum must be fat enough to BURY the two square-cut curtain end-faces that meet at its
  // vertex (incl. the battered plinth flare) — at a diagonal corner the ends splay, so the drum is
  // sized generously past the curtain thickness and visibly projects beyond the wall line.
  const dia = Math.max(mToTiles(3.0), opts.curtainThickness + mToTiles(opts.tall ? 1.4 : 3.2));
  const r = dia / 2;
  // Rise SCALES with the curtain, then the whole tower is floored by MIN_TOWER_ASPECT. A flat
  // constant rise made a thick-walled ring's drums as wide as they were tall (7.2 m across vs
  // 8.2 m tall on a 6 m curtain 4 m thick — aspect 1.14), so the corners read as rounded fillets
  // on the wall rather than towers standing clear of it.
  const rise = Math.max(mToTiles(opts.tall ? 3.6 : 2.2), opts.curtainHeight * (opts.tall ? 0.75 : 0.5));
  const towerH = Math.max(opts.curtainHeight + rise, dia * MIN_TOWER_ASPECT);
  const parapetH = parapetHeight(opts.curtainHeight);
  const baseH = mToTiles(1.2);
  const flare = mToTiles(0.6);
  const corbel = mToTiles(0.32);
  const corbelH = mToTiles(0.5);
  const walkZ = towerH - parapetH;
  const center: [number, number] = [cx, cy];

  const parts: Part[] = [];
  // Battered frustum foot (a tapered drum — wide at grade, narrowing to the shaft).
  parts.push({ prim: 'column', center, baseZ: 0, radius: r + flare, topRadius: r, height: baseH, material: mat });
  // Cylindrical shaft — an entrance doorway on the inner side (if oriented).
  const door = opts.inward ? doorwayAperture(cx, cy, r, opts.inward) : undefined;
  parts.push({ prim: 'cylinder', center, baseZ: baseH * 0.7, radius: r, height: walkZ - baseH * 0.7, material: mat, ...(door ? { apertures: [door] } : {}) });
  // Corbel ring (machicolation) overhanging just below the parapet.
  parts.push({ prim: 'cylinder', center, baseZ: walkZ - corbelH, radius: r + corbel, height: corbelH, material: mat });
  // Crenellated parapet wrapped around the corbel-widened ring: a continuous sill ring with the
  // teeth standing on it (matching the curtain's base course — teeth alone read as loose blocks).
  const pt = mToTiles(0.4), rp = r + corbel;
  const sillH = parapetH * PARAPET_BASE_COURSE_FRAC;
  parts.push(...ringCourse(cx, cy, rp, walkZ, sillH, pt, mat));
  parts.push(...merlonsAroundRing(cx, cy, rp, walkZ, parapetH, pt, mat));

  return { parts: withWork(parts, opts.work), mountAnchors: [{ kind: 'lintel', x: cx, y: cy, facing: [0, 0], z: 0 }], side: dia };
}

/** Build a tower (round drum by default; square when `round` is false) centred at (cx,cy). */
export function towerSpec(opts: TowerOpts, cx = 0, cy = 0): TowerSpec {
  return opts.round ? roundTower(opts, cx, cy) : squareTower(opts, cx, cy);
}
