// src/blueprint/parts/column.ts
// The kit's Column part — ONE class-neutral vertical support, the same way `body` is one
// class-neutral building. A column emits a single `column` prim (assetgen/geometry/column.ts:
// base + tapered shaft + capital), so it inherits resolve → compile → manifold → SpritePack →
// banded lighting for free. Variety is params, not presets: `shape` (round/square/polygon),
// `taper` (classical diminution / structural batter), `base`/`capital` (plinth + abacus).
// Consumers — bridge pier, arcade post, colonnade member, porch post, baluster — are this one
// part with different params; pairing it with the Arch primitive yields an arcade.
import type { Part } from '../types';
import type { PartType, CompileCtx, ResolveCtx } from '../registry';
import type { Mat } from '@/assetgen/types';
import type { Part as Prim } from '@/assetgen/compose';
import type { ColumnShape, ColumnBand } from '@/assetgen/geometry/column';
import { mToTiles } from '@/render/scale-contract';
import { WALL_MAT } from './body';

function matOf(ctx: CompileCtx): Mat {
  return WALL_MAT[ctx.materials.walls] ?? 'stone';
}

export const columnPartType: PartType = {
  type: 'column',
  paramSchema: {
    /** Total height (base + shaft + capital) in metres. */
    heightM: { kind: 'number', min: 0.3, max: 20, default: 3 },
    /** Shaft half-width (round: radius) at the foot, metres. */
    radiusM: { kind: 'number', min: 0.05, max: 3, default: 0.3 },
    /** Cross-section. */
    shape: { kind: 'enum', values: ['round', 'square', 'polygon'], default: 'round' },
    /** Sides for `polygon` (ignored otherwise). */
    sides: { kind: 'number', min: 3, max: 12, default: 8 },
    /** Diminution / batter: top half-width = (1 − taper) × base. 0 = parallel sides. */
    taper: { kind: 'number', min: 0, max: 0.6, default: 0 },
    /** Add a plinth at the foot. */
    base: { kind: 'bool', default: false },
    /** Add a capital/abacus at the head. */
    capital: { kind: 'bool', default: false },
  },
  resolve: (part: Part, _ctx: ResolveCtx) => ({ params: { ...(part.params ?? {}) } }),
  toPrims(p, ctx): Prim[] {
    const mat = matOf(ctx);
    const r = mToTiles((p.params.radiusM as number) ?? 0.3);
    const h = mToTiles((p.params.heightM as number) ?? 3);
    const taper = (p.params.taper as number) ?? 0;
    const shape = (p.params.shape as ColumnShape) ?? 'round';
    // Plinth/abacus proportioned to the shaft: a squat band ~1.2× the radius tall,
    // jutting ~0.4× the radius past the shaft.
    const band: ColumnBand = { heightU: r * 1.2, oversizeU: r * 0.4 };
    return [{
      prim: 'column',
      center: [p.at.x + r, p.at.y + r],   // footprint min-corner `at` → column occupies [at, at+2r]
      baseZ: 0,
      shape,
      sides: (p.params.sides as number) ?? 8,
      radius: r,
      topRadius: r * (1 - taper),
      height: h,
      base: (p.params.base as boolean) ? band : null,
      capital: (p.params.capital as boolean) ? band : null,
      material: mat,
    }];
  },
  toCollision(p) { return [[p.at.x, p.at.y]]; },
  toAnchors: () => [],
  toBrief(p) {
    const shape = (p.params.shape as string) ?? 'round';
    const tapered = ((p.params.taper as number) ?? 0) > 0.02;
    return `${tapered ? 'tapered ' : ''}${shape} column`;
  },
};
