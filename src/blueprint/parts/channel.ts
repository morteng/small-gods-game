// src/blueprint/parts/channel.ts
// The kit's Channel/trough — a lined conduit run along an axis: a recessed floor between two
// side walls (an open flume), optionally capped (a covered conduit). It replaces the
// aqueduct's deck+parapet FAKE (a flat deck with rails on top, so "water" sat on a flat
// surface) with a real trough whose floor sits BELOW the wall tops, and is the primitive the
// G7 irrigation layer, mill races, drains and moats will all draw from. Pure prim emission.
import type { Part } from '../types';
import type { PartType, CompileCtx, ResolveCtx } from '../registry';
import type { Mat, Vec3 } from '@/assetgen/types';
import type { Part as Prim } from '@/assetgen/compose';
import { mToTiles } from '@/render/scale-contract';
import { WALL_MAT } from './body';

export interface ChannelOpts {
  /** Run length along `axis`, cube-units. */
  lengthU: number;
  axis: 'x' | 'y';
  /** Inner (water) width between the side walls, cube-units. */
  innerU: number;
  /** Side-wall thickness, cube-units. */
  wallU?: number;
  /** Wall height above the floor (= the trough depth), cube-units. */
  depthU?: number;
  /** Floor slab thickness, cube-units. */
  floorU?: number;
  /** Cap the trough (covered conduit) instead of leaving it open (flume). */
  covered?: boolean;
  material: Mat;
}

const DEF_WALL = mToTiles(0.3);
const DEF_DEPTH = mToTiles(0.6);
const DEF_FLOOR = mToTiles(0.3);

/** A box spanning `aLen` along the run from along-offset `a0`, at cross-offset `c0` `cW` wide,
 *  from z `z0` rising `h`. (axis x: along=x, cross=y; axis y: along=y, cross=x.) */
function box(at: Vec3, axis: 'x' | 'y', a0: number, aLen: number, c0: number, cW: number, z0: number, h: number, mat: Mat): Prim {
  return axis === 'x'
    ? { prim: 'box', at: [at[0] + a0, at[1] + c0, at[2] + z0], size: [aLen, cW, h], material: mat }
    : { prim: 'box', at: [at[0] + c0, at[1] + a0, at[2] + z0], size: [cW, aLen, h], material: mat };
}

/** Prims for one channel run from `at` (outer base corner), running `lengthU` along `axis`. The
 *  outer width is `innerU + 2·wallU`; the floor spans it, the two walls rise above the floor. */
export function channelPrims(at: Vec3, opts: ChannelOpts): Prim[] {
  const len = opts.lengthU, axis = opts.axis, inner = opts.innerU, mat = opts.material;
  const wall = opts.wallU ?? DEF_WALL;
  const depth = opts.depthU ?? DEF_DEPTH;
  const floor = opts.floorU ?? DEF_FLOOR;
  const outer = inner + 2 * wall;
  const out: Prim[] = [
    box(at, axis, 0, len, 0, outer, 0, floor, mat),               // floor slab (full outer width)
    box(at, axis, 0, len, 0, wall, floor, depth, mat),            // near side wall
    box(at, axis, 0, len, wall + inner, wall, floor, depth, mat), // far side wall
  ];
  if (opts.covered) {
    out.push(box(at, axis, 0, len, wall, inner, floor + depth, mToTiles(0.25), mat)); // capstone lid
  }
  return out;
}

function matOf(ctx: CompileCtx): Mat {
  return WALL_MAT[ctx.materials.walls] ?? 'stone';
}

export const channelPartType: PartType = {
  type: 'channel',
  paramSchema: {
    lengthM: { kind: 'number', min: 0.5, max: 60, default: 4 },
    axis: { kind: 'enum', values: ['x', 'y'], default: 'x' },
    innerWidthM: { kind: 'number', min: 0.2, max: 8, default: 1 },
    wallM: { kind: 'number', min: 0.1, max: 2, default: 0.3 },
    depthM: { kind: 'number', min: 0.2, max: 4, default: 0.6 },
    floorM: { kind: 'number', min: 0.1, max: 2, default: 0.3 },
    covered: { kind: 'bool', default: false },
  },
  resolve: (part: Part, _ctx: ResolveCtx) => ({ params: { ...(part.params ?? {}) } }),
  toPrims(p, ctx): Prim[] {
    return channelPrims([p.at.x, p.at.y, 0], {
      lengthU: mToTiles((p.params.lengthM as number) ?? 4),
      axis: (p.params.axis as 'x' | 'y') ?? 'x',
      innerU: mToTiles((p.params.innerWidthM as number) ?? 1),
      wallU: mToTiles((p.params.wallM as number) ?? 0.3),
      depthU: mToTiles((p.params.depthM as number) ?? 0.6),
      floorU: mToTiles((p.params.floorM as number) ?? 0.3),
      covered: (p.params.covered as boolean) ?? false,
      material: matOf(ctx),
    });
  },
  // A channel carries water ON it (the conduit IS the surface) — like a deck, it blocks no
  // land traversal cell; routing rides the carved tiles beneath. Footprint sizes via the
  // blueprint `size`, so siting still reserves its cells.
  toCollision: () => [],
  toAnchors: () => [],
  toBrief(p) { return `${(p.params.covered as boolean) ? 'covered ' : ''}channel`; },
};
