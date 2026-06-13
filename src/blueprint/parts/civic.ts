// src/blueprint/parts/civic.ts
// Civic prop parts — small free-standing structures that are NOT buildings:
// a village well (curb + posts + canopy) and a graveyard (a scatter of
// headstones). They emit only standalone prims (cylinder/box/cone/prism), so
// `toGeometry` folds them like the yurt's round body (no `prim:'building'`),
// and they flow through the SAME generate→sprite pipeline as buildings.
import type { PartType } from '../registry';
import type { Part as Prim } from '@/assetgen/compose';
import type { Mat } from '@/assetgen/types';
import { mToTiles } from '@/render/scale-contract';
import { WALL_MAT, ROOF_MAT } from './body';

const wallMatOf = (walls: string): Mat => WALL_MAT[walls] ?? 'stone';
const roofMatOf = (roof: string): Mat => ROOF_MAT[roof] ?? 'tile';

/**
 * A village well: a low stone curb (cylinder) with two timber posts carrying a
 * small pitched canopy (cone). Sized to a 1×1 footprint.
 */
export const wellPartType: PartType = {
  type: 'well',
  paramSchema: {},
  resolve: (part) => ({ params: { ...(part.params ?? {}) } }),
  toPrims(p, ctx): Prim[] {
    const cx = p.at.x + p.size.w / 2, cy = p.at.y + p.size.h / 2;
    const curbMat = wallMatOf(ctx.materials.walls);
    const capMat = roofMatOf(ctx.materials.roof);
    const curbH = mToTiles(0.9);
    const postH = mToTiles(2.1);
    const post = 0.12;
    return [
      // stone curb
      { prim: 'cylinder', center: [cx, cy], baseZ: 0, radius: 0.34, height: curbH, material: curbMat },
      // two timber posts straddling the curb
      { prim: 'box', at: [cx - 0.40, cy - post / 2, 0], size: [post, post, postH], material: 'timber' },
      { prim: 'box', at: [cx + 0.40 - post, cy - post / 2, 0], size: [post, post, postH], material: 'timber' },
      // pitched canopy
      { prim: 'cone', center: [cx, cy], baseZ: postH, radius: 0.52, height: mToTiles(0.7), material: capMat },
    ];
  },
  toCollision(p) {
    const cells: Array<[number, number]> = [];
    for (let i = 0; i < p.size.w; i++) for (let j = 0; j < p.size.h; j++) cells.push([p.at.x + i, p.at.y + j]);
    return cells;
  },
  toAnchors: () => [],
  toBrief: () => 'a stone village well with a timber-framed canopy',
};

/** Deterministic headstone layout (footprint-local tiles + relative height), no rng. */
const HEADSTONES: Array<{ dx: number; dy: number; h: number }> = [
  { dx: 0.45, dy: 0.40, h: 0.85 },
  { dx: 1.15, dy: 0.55, h: 0.70 },
  { dx: 1.55, dy: 1.10, h: 0.90 },
  { dx: 0.60, dy: 1.35, h: 0.65 },
  { dx: 1.20, dy: 0.95, h: 0.78 },
  { dx: 0.85, dy: 0.70, h: 0.72 },
  { dx: 1.45, dy: 1.55, h: 0.80 },
  { dx: 0.40, dy: 1.05, h: 0.68 },
];

/**
 * A graveyard: a deterministic scatter of stone headstone slabs over its
 * footprint (2×2). `stones` (default 5, a Fate seam) bounds how many; later
 * driven by the entity's `buried` count from S6.
 */
export const graveyardPartType: PartType = {
  type: 'graveyard',
  paramSchema: { stones: { kind: 'number', min: 0, max: 24, default: 5 } },
  resolve: (part) => ({ params: { ...(part.params ?? {}) } }),
  toPrims(p, ctx): Prim[] {
    const n = Math.max(0, Math.min(HEADSTONES.length, (p.params.stones as number) ?? 5));
    const mat = wallMatOf(ctx.materials.walls);
    const slabW = 0.26, slabD = 0.10;
    return HEADSTONES.slice(0, n).map(({ dx, dy, h }) => ({
      prim: 'box' as const,
      at: [p.at.x + dx - slabW / 2, p.at.y + dy - slabD / 2, 0],
      size: [slabW, slabD, mToTiles(h)],
      material: mat,
    }));
  },
  toCollision(p) {
    const cells: Array<[number, number]> = [];
    for (let i = 0; i < p.size.w; i++) for (let j = 0; j < p.size.h; j++) cells.push([p.at.x + i, p.at.y + j]);
    return cells;
  },
  toAnchors: () => [],
  toBrief: () => 'a small graveyard of weathered stone headstones',
};
