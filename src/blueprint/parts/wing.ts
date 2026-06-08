// src/blueprint/parts/wing.ts
// Additive rectangular wing: emits one `prim:'building'` wing the geometry compiler
// merges into the body's building prim. Use `at`/`size` for placement.
import type { PartType, CompileCtx } from '../registry';
import type { Part as Prim } from '@/assetgen/compose';
import type { Wing, RoofKind } from '@/assetgen/geometry/building';
import { WALL_MAT, ROOF_MAT, ROOF_KIND } from './body';

export const wingPartType: PartType = {
  type: 'wing',
  paramSchema: {
    levels: { kind: 'number', min: 1, max: 8, default: 1 },
    roof: { kind: 'enum', values: ['flat', 'gable', 'hip', 'pyramidal', 'lean_to', 'conical', 'domed'], default: 'gable' },
  },
  resolve: (part) => ({ params: { ...(part.params ?? {}) } }),
  toPrims(p, ctx: CompileCtx): Prim[] {
    const wing: Wing = {
      x: p.at.x, y: p.at.y, w: p.size.w, h: p.size.h,
      storeys: Math.max(1, p.params.levels as number),
      roof: (ROOF_KIND[p.params.roof as string] ?? 'gable') as RoofKind,
    };
    return [{
      prim: 'building', wings: [wing],
      wallMat: WALL_MAT[ctx.materials.walls] ?? 'plaster',
      roofMat: ROOF_MAT[ctx.materials.roof] ?? 'tile',
      roofStyle: 'gable', features: {}, seed: 0,
    }];
  },
  toCollision(p) {
    const cells: Array<[number, number]> = [];
    for (let i = 0; i < p.size.w; i++) for (let j = 0; j < p.size.h; j++) cells.push([p.at.x + i, p.at.y + j]);
    return cells;
  },
  toAnchors: () => [],
  toBrief: () => 'wing',
};
