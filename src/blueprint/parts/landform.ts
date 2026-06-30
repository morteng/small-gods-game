// src/blueprint/parts/landform.ts
// NATURAL LANDFORM parts — parametric mesh props for terrain features a single-
// valued heightfield physically cannot represent (a hole through rock, an
// overhang). They emit the SAME assetgen prims as buildings (`arch` + `rock`), so
// they flow through the generate→SpritePack pipeline self-lit, with no img2img art
// and no heightfield. `sea_arch` is the first: a weathered coastal rock arch.
import type { PartType } from '../registry';
import type { Part as Prim } from '@/assetgen/compose';
import type { Vec3 } from '@/assetgen/types';
import { mToTiles } from '@/render/scale-contract';

const footprintCells = (p: { at: { x: number; y: number }; size: { w: number; h: number } }): Array<[number, number]> => {
  const cells: Array<[number, number]> = [];
  for (let i = 0; i < p.size.w; i++) for (let j = 0; j < p.size.h; j++) cells.push([p.at.x + i, p.at.y + j]);
  return cells;
};

/**
 * A weathered sea arch: a round rock ring (a real opening you can see the sea
 * through — impossible in a heightfield) roughened by lumpy boulders at the
 * abutments and an eroded crown ON TOP of the spandrel, so it reads as natural
 * eroded stone rather than a clean masonry bridge. All prims already exist
 * (`arch` style:'round' + noise-displaced `rock`); this just composes them.
 */
export const seaArchPartType: PartType = {
  type: 'sea_arch',
  paramSchema: {
    spanM:  { kind: 'number', min: 4, max: 24, default: 13 },   // clear opening width
    riseM:  { kind: 'number', min: 2, max: 16, default: 8 },    // crown height above springing
    depthM: { kind: 'number', min: 2, max: 14, default: 6 },    // headland thickness (a mass, not a gate)
    seed:   { kind: 'number', default: 0 },
  },
  resolve: (part, ctx) => ({
    params: {
      spanM: 13, riseM: 8, depthM: 6,
      ...(part.params ?? {}),
      seed: (part.params?.seed as number | undefined) ?? (ctx.seed >>> 0),
    },
  }),
  toPrims(p): Prim[] {
    const seed = (p.params.seed as number) >>> 0;
    const span = mToTiles(p.params.spanM as number);
    const rise = mToTiles(p.params.riseM as number);
    const depth = mToTiles(p.params.depthM as number);
    const footR = mToTiles(4) / 2;
    const cy = depth / 2;
    const at: Vec3 = [0, 0, 0];
    return [
      { prim: 'arch', at, span, height: rise, thickness: depth, style: 'round', material: 'stone' },
      // weathered rock piers hugging the two feet (thicken the legs into eroded stone)
      { prim: 'rock', center: [0.0, cy],        baseZ: 0,           radius: footR,           seed: seed * 7 + 1, jitter: 0.55, mat: 'stone' },
      { prim: 'rock', center: [span, cy],       baseZ: 0,           radius: footR,           seed: seed * 7 + 2, jitter: 0.55, mat: 'stone' },
      // eroded crown SITTING ON TOP of the spandrel — breaks the rectangular
      // silhouette into a natural rocky hump, never over the opening
      { prim: 'rock', center: [span * 0.58, cy * 0.92], baseZ: rise * 0.92, radius: mToTiles(8) / 2, seed: seed * 7 + 3, jitter: 0.62, mat: 'stone' },
      { prim: 'rock', center: [span * 0.30, cy * 1.1],  baseZ: rise * 0.88, radius: mToTiles(6) / 2, seed: seed * 7 + 4, jitter: 0.62, mat: 'stone' },
    ];
  },
  toCollision: (p) => footprintCells(p),
  toAnchors: () => [],
  toBrief: () => 'a weathered sea arch, a rock ring the surf has bored through',
};
