// src/blueprint/parts/structural.ts
// Additive structural parts: tower, porch, chimney. Each emits standalone prims the
// geometry compiler unions alongside the body's building prim.
import type { PartType, CompileCtx } from '../registry';
import type { Part as Prim } from '@/assetgen/compose';
import { STOREY } from '@/assetgen/geometry/building';
import { WALL_MAT, ROOF_MAT } from './body';

const cellsOf = (p: { at: { x: number; y: number }; size: { w: number; h: number } }): Array<[number, number]> => {
  const out: Array<[number, number]> = [];
  for (let i = 0; i < p.size.w; i++) for (let j = 0; j < p.size.h; j++) out.push([p.at.x + i, p.at.y + j]);
  return out;
};

export const towerPartType: PartType = {
  type: 'tower',
  paramSchema: {
    levels: { kind: 'number', min: 1, max: 12, default: 3 },
    shape: { kind: 'enum', values: ['square', 'round'], default: 'square' },
    roof: { kind: 'enum', values: ['flat', 'pyramidal', 'conical', 'domed'], default: 'pyramidal' },
  },
  resolve: (part) => ({ params: { ...(part.params ?? {}) } }),
  toPrims(p, ctx: CompileCtx): Prim[] {
    const wallMat = WALL_MAT[ctx.materials.walls] ?? 'stone';
    const roofMat = ROOF_MAT[ctx.materials.roof] ?? 'stone';
    const h = Math.max(1, p.params.levels as number) * STOREY;
    if (p.params.shape === 'round') {
      const r = Math.min(p.size.w, p.size.h) / 2, cx = p.at.x + p.size.w / 2, cy = p.at.y + p.size.h / 2;
      const out: Prim[] = [{ prim: 'cylinder', center: [cx, cy], baseZ: 0, radius: r, height: h, material: wallMat }];
      if (p.params.roof !== 'flat') out.push({ prim: 'cone', center: [cx, cy], baseZ: h, radius: r, height: r * 1.2, material: roofMat });
      return out;
    }
    const out: Prim[] = [{ prim: 'box', at: [p.at.x, p.at.y, 0], size: [p.size.w, p.size.h, h], material: wallMat }];
    if (p.params.roof !== 'flat') {
      const cx = p.at.x + p.size.w / 2, cy = p.at.y + p.size.h / 2, r = Math.min(p.size.w, p.size.h) / 2;
      out.push({ prim: 'cone', center: [cx, cy], baseZ: h, radius: r, height: r, material: roofMat });
    }
    return out;
  },
  toCollision: (p) => cellsOf(p),
  toAnchors: () => [],
  toBrief: (p) => `${p.params.shape} tower`,
};

export const porchPartType: PartType = {
  type: 'porch',
  paramSchema: { depth: { kind: 'number', min: 1, max: 3, default: 1 } },
  resolve: (part) => ({ params: { ...(part.params ?? {}) } }),
  toPrims(p, ctx: CompileCtx): Prim[] {
    const wallMat = WALL_MAT[ctx.materials.walls] ?? 'timber';
    return [{ prim: 'box', at: [p.at.x, p.at.y, 0], size: [p.size.w, p.size.h, STOREY * 0.6], material: wallMat }];
  },
  toCollision: (p) => cellsOf(p),
  toAnchors: () => [],
  toBrief: () => 'covered porch',
};

export const chimneyPartType: PartType = {
  type: 'chimney',
  paramSchema: { height: { kind: 'number', min: 0.2, max: 3, default: 1 } },
  resolve: (part) => ({ params: { ...(part.params ?? {}) } }),
  toPrims(p): Prim[] {
    const top = STOREY + (p.params.height as number);
    return [{ prim: 'box', at: [p.at.x + 0.3, p.at.y + 0.3, 0], size: [0.4, 0.4, top], material: 'brick' }];
  },
  toCollision: () => [],         // a chimney rides the roof; it blocks no ground cell
  toAnchors: () => [],
  toBrief: () => 'chimney',
};
