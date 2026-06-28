// src/blueprint/parts/railing.ts
// The kit's Railing family — ONE edge-profile generator run along an edge, the way Arch is
// one curved primitive and Column one support. It unifies the bespoke edge treatments that
// were hand-rolled per consumer: the bridge/deck parapet (two solid boxes), the stair
// balustrade (a post loop), and gives the kit the rest of the family — open balustrade,
// picket fence, coping course and a prim-based crenellation — so deck edges, stair edges,
// terraces/balconies and prim wall-tops all draw from one place. Balusters/pickets compose
// from the `column` prim (a baluster IS a short column), so the kit reuses itself.
//
// `railingPrims` is the shared geometry; `railingPartType` exposes it as a standalone part.
// Pure prim emission → inherits resolve → compile → manifold → SpritePack → lighting.
import type { Part } from '../types';
import type { PartType, CompileCtx, ResolveCtx } from '../registry';
import type { Mat, Vec3 } from '@/assetgen/types';
import type { Part as Prim } from '@/assetgen/compose';
import { mToTiles } from '@/render/scale-contract';
import { WALL_MAT } from './body';

export type RailStyle = 'parapet' | 'balustrade' | 'picket' | 'coping' | 'crenellated';

export interface RailingOpts {
  style: RailStyle;
  /** Run length along `axis`, cube-units. */
  lengthU: number;
  /** Run direction. The railing occupies the `thickU` band from the base corner across. */
  axis: 'x' | 'y';
  /** Total height above the base, cube-units. Default ~0.95 m. */
  heightU?: number;
  /** Thickness across the run, cube-units. Default ~0.22 m. */
  thickU?: number;
  material: Mat;
}

const DEF_H = mToTiles(0.95);
const DEF_T = mToTiles(0.22);

/** A box spanning `aLen` along the run from along-offset `a0`, `cross` thick, at z `z0`+`h`. */
function boxAlong(at: Vec3, axis: 'x' | 'y', a0: number, aLen: number, cross: number, z0: number, h: number, mat: Mat): Prim {
  return axis === 'x'
    ? { prim: 'box', at: [at[0] + a0, at[1], at[2] + z0], size: [aLen, cross, h], material: mat }
    : { prim: 'box', at: [at[0], at[1] + a0, at[2] + z0], size: [cross, aLen, h], material: mat };
}

/** A square baluster/picket (a short Column) centred at along-offset `aC`, cross-offset `cC`. */
function postAlong(at: Vec3, axis: 'x' | 'y', aC: number, cC: number, r: number, z0: number, h: number, mat: Mat): Prim {
  const cx = axis === 'x' ? at[0] + aC : at[0] + cC;
  const cy = axis === 'x' ? at[1] + cC : at[1] + aC;
  return { prim: 'column', center: [cx, cy], baseZ: at[2] + z0, shape: 'square', radius: r, height: h, material: mat };
}

/** Evenly spaced centres along a run of `len`, one roughly every `spacingU` (≥2 posts). */
function centres(len: number, spacingU: number): number[] {
  const n = Math.max(2, Math.round(len / spacingU));
  const step = len / n;
  const out: number[] = [];
  for (let i = 0; i <= n; i++) out.push(i * step);
  return out;
}

/** Prims for one railing run starting at `at` (base corner), running `lengthU` along `axis`. */
export function railingPrims(at: Vec3, opts: RailingOpts): Prim[] {
  const len = opts.lengthU;
  const axis = opts.axis;
  const H = opts.heightU ?? DEF_H;
  const T = opts.thickU ?? DEF_T;
  const mat = opts.material;
  const cC = T / 2;                        // cross-centre of the band (for posts)
  const out: Prim[] = [];

  switch (opts.style) {
    case 'parapet':
      out.push(boxAlong(at, axis, 0, len, T, 0, H, mat));
      break;

    case 'coping':
      // A low capping course — a squat solid band (terrace lip / wall coping).
      out.push(boxAlong(at, axis, 0, len, T, 0, H * 0.35, mat));
      break;

    case 'balustrade': {
      // Bottom rail + top rail + slim balusters between them.
      const railT = Math.min(H * 0.14, mToTiles(0.12));
      out.push(boxAlong(at, axis, 0, len, T, 0, railT, mat));               // bottom rail
      out.push(boxAlong(at, axis, 0, len, T, H - railT, railT, mat));       // top rail (handrail)
      const r = Math.min(T * 0.45, mToTiles(0.05));
      for (const a of centres(len, mToTiles(0.22))) {
        out.push(postAlong(at, axis, a, cC, r, railT, H - 2 * railT, mat));
      }
      break;
    }

    case 'picket': {
      const railT = Math.min(H * 0.16, mToTiles(0.1));
      out.push(boxAlong(at, axis, 0, len, T, H - railT, railT, mat));       // top rail
      const r = Math.min(T * 0.4, mToTiles(0.04));
      for (const a of centres(len, mToTiles(0.16))) {
        out.push(postAlong(at, axis, a, cC, r, 0, H, mat));                 // close pickets
      }
      break;
    }

    case 'crenellated': {
      // Merlons (solid teeth) with crenels (gaps) between — a prim crenellation for
      // deck/wall-top edges that ride the parametric pipeline (NOT the iso-barrier path).
      const period = mToTiles(0.9);                  // merlon + crenel
      const n = Math.max(1, Math.round(len / period));
      const w = len / n;
      for (let i = 0; i < n; i++) {
        out.push(boxAlong(at, axis, i * w, w * 0.5, T, 0, H, mat));         // merlon (half), then a gap
      }
      // A continuous low base course under the teeth so light doesn't leak through the crenels.
      out.push(boxAlong(at, axis, 0, len, T, 0, H * 0.45, mat));
      break;
    }
  }
  return out;
}

function matOf(ctx: CompileCtx): Mat {
  return WALL_MAT[ctx.materials.walls] ?? 'stone';
}

export const railingPartType: PartType = {
  type: 'railing',
  paramSchema: {
    style: { kind: 'enum', values: ['parapet', 'balustrade', 'picket', 'coping', 'crenellated'], default: 'balustrade' },
    lengthM: { kind: 'number', min: 0.3, max: 60, default: 4 },
    axis: { kind: 'enum', values: ['x', 'y'], default: 'x' },
    heightM: { kind: 'number', min: 0.2, max: 4, default: 0.95 },
    thicknessM: { kind: 'number', min: 0.05, max: 1.5, default: 0.22 },
  },
  resolve: (part: Part, _ctx: ResolveCtx) => ({ params: { ...(part.params ?? {}) } }),
  toPrims(p, ctx): Prim[] {
    return railingPrims([p.at.x, p.at.y, 0], {
      style: (p.params.style as RailStyle) ?? 'balustrade',
      lengthU: mToTiles((p.params.lengthM as number) ?? 4),
      axis: (p.params.axis as 'x' | 'y') ?? 'x',
      heightU: mToTiles((p.params.heightM as number) ?? 0.95),
      thickU: mToTiles((p.params.thicknessM as number) ?? 0.22),
      material: matOf(ctx),
    });
  },
  toCollision: () => [],     // a thin edge treatment — blocks no traversal cell on its own
  toAnchors: () => [],
  toBrief(p) { return `${(p.params.style as string) ?? 'balustrade'} railing`; },
};
