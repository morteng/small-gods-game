// src/blueprint/parts/lightweight.ts
// Open-frame, wall-less structures — a market stall and a tent. Like the civic props
// (well/graveyard) they emit only standalone prims (box/cone), so `toGeometry` folds
// them without a `prim:'building'` and they flow through the SAME generate→sprite
// pipeline. This is the seed of the open-frame family (shacks, awnings, more tent
// kinds follow); kept deliberately small for now.
import type { PartType } from '../registry';
import type { Part as Prim } from '@/assetgen/compose';
import type { Mat } from '@/assetgen/types';
import { mToTiles } from '@/render/scale-contract';
import { WALL_MAT } from './body';

const wallMatOf = (walls: string): Mat => WALL_MAT[walls] ?? 'plaster';

const footprintCells = (p: { at: { x: number; y: number }; size: { w: number; h: number } }): Array<[number, number]> => {
  const cells: Array<[number, number]> = [];
  for (let i = 0; i < p.size.w; i++) for (let j = 0; j < p.size.h; j++) cells.push([p.at.x + i, p.at.y + j]);
  return cells;
};

/**
 * An open market stall: four timber corner posts carrying a peaked canopy, with a
 * waist-high counter along the front (+y) face. No walls — the produce, not masonry,
 * fills the frame. The canopy reuses the cone the village well already proved out.
 */
export const stallPartType: PartType = {
  type: 'stall',
  paramSchema: {
    counter: { kind: 'bool', default: true },
    postHeightM: { kind: 'number', min: 1.4, max: 3.5, default: 1.9 },
    canopyRiseM: { kind: 'number', min: 0.3, max: 3.5, default: 2.6 },
  },
  resolve: (part) => ({ params: { ...(part.params ?? {}) } }),
  toPrims(p, _ctx): Prim[] {
    const { w, h } = p.size, x0 = p.at.x, y0 = p.at.y;
    const cx = x0 + w / 2, cy = y0 + h / 2;
    const post = 0.14, inset = 0.18;
    const postH = mToTiles(p.params.postHeightM as number);
    // A market awning is CLOTH, not straw — pale canvas (plaster) reads as a stretched
    // cloth canopy. (Striped cloth awaits a per-face material pass; expand later.)
    const canopyMat: Mat = 'plaster';
    const prims: Prim[] = [];
    // four corner posts
    for (const [px, py] of [
      [x0 + inset, y0 + inset], [x0 + w - inset - post, y0 + inset],
      [x0 + inset, y0 + h - inset - post], [x0 + w - inset - post, y0 + h - inset - post],
    ]) prims.push({ prim: 'box', at: [px, py, 0], size: [post, post, postH], material: 'timber' });
    // counter along the front (south, +y) at ~waist height
    if (p.params.counter) {
      const cH = mToTiles(0.9), cD = 0.24;
      prims.push({ prim: 'box', at: [x0 + inset, y0 + h - inset - cD, 0], size: [w - 2 * inset, cD, cH], material: 'timber' });
    }
    // peaked canopy over the posts — a tall cone reads as a pointed cloth awning
    // (a flat one looks like a table). Oversails the posts a touch for shade.
    prims.push({
      prim: 'cone', center: [cx, cy], baseZ: postH,
      radius: Math.min(w, h) / 2 + 0.12, height: mToTiles(p.params.canopyRiseM as number), material: canopyMat,
    });
    return prims;
  },
  toCollision: footprintCells,
  toAnchors: () => [],
  toBrief: () => 'an open market stall with a peaked canopy on timber posts',
};

/**
 * A tent: a canvas cone over a centre pole, with a dark entrance flap on the front.
 * `heightM` sets the rise (a squat bell vs a tall teepee). Canvas reads off the wall
 * material (hide → pale plaster). The single seed of the tent family.
 */
export const tentPartType: PartType = {
  type: 'tent',
  paramSchema: {
    heightM: { kind: 'number', min: 1.2, max: 6, default: 2.6 },
    pole: { kind: 'bool', default: true },
  },
  resolve: (part) => ({ params: { ...(part.params ?? {}) } }),
  toPrims(p, ctx): Prim[] {
    const { w, h } = p.size, cx = p.at.x + w / 2, cy = p.at.y + h / 2;
    const r = Math.min(w, h) / 2;
    const ht = mToTiles(p.params.heightM as number);
    const canvas = wallMatOf(ctx.materials.walls);
    const prims: Prim[] = [{ prim: 'cone', center: [cx, cy], baseZ: 0, radius: r, height: ht, material: canvas }];
    if (p.params.pole) prims.push({ prim: 'box', at: [cx - 0.04, cy - 0.04, 0], size: [0.08, 0.08, ht + 0.18], material: 'timber' });
    // entrance flap: a dark opening on the front (south, +y) base
    prims.push({ prim: 'box', at: [cx - 0.18, cy + r - 0.14, 0], size: [0.36, 0.16, mToTiles(1.0)], material: 'door' });
    return prims;
  },
  toCollision: footprintCells,
  toAnchors: () => [],
  toBrief: () => 'a canvas tent over a centre pole',
};
