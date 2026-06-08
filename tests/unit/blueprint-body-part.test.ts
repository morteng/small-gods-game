// tests/unit/blueprint-body-part.test.ts
import { describe, it, expect } from 'vitest';
import { bodyPartType, bodyWings, WALL_MAT, ROOF_MAT, ROOF_KIND } from '@/blueprint/parts/body';
import type { ResolvedPart } from '@/blueprint/types';

function part(params: Record<string, unknown>, size = { w: 3, h: 3 }): ResolvedPart {
  return { id: 'body', type: 'body', at: { x: 0, y: 0 }, size, params, features: [] };
}
const ctx = { materials: { walls: 'timber', roof: 'thatch' }, footprint: { w: 3, h: 3 } };

describe('body part — wings', () => {
  it('rect plan → one wing covering the structure', () => {
    expect(bodyWings(part({ plan: 'rect', levels: 1, roof: 'gable' }))).toEqual([{ x: 0, y: 0, w: 3, h: 3 }]);
  });
  it('cross plan → nave + transept', () => {
    expect(bodyWings(part({ plan: 'cross', levels: 1, roof: 'hip' })).length).toBe(2);
  });
});

describe('body part — toPrims', () => {
  it('rect → a single building prim', () => {
    const prims = bodyPartType.toPrims(part({ plan: 'rect', levels: 2, roof: 'gable' }), ctx);
    expect(prims).toHaveLength(1);
    expect(prims[0].prim).toBe('building');
    if (prims[0].prim === 'building') {
      expect(prims[0].wings[0]).toMatchObject({ x: 0, y: 0, w: 3, h: 3, storeys: 2 });
      expect(prims[0].wallMat).toBe('timber');
      expect(prims[0].roofMat).toBe('thatch');
    }
  });
  it('round → cylinder + cap prims', () => {
    const prims = bodyPartType.toPrims(part({ plan: 'round', levels: 1, roof: 'domed' }, { w: 2, h: 2 }), ctx);
    expect(prims.map(p => p.prim)).toEqual(['cylinder', 'ellipsoid']);
  });
  it('stepped → stacked boxes', () => {
    const prims = bodyPartType.toPrims(part({ plan: 'stepped', levels: 3, levelInset: 1, roof: 'stepped' }), ctx);
    expect(prims.every(p => p.prim === 'box')).toBe(true);
    expect(prims.length).toBeGreaterThanOrEqual(1);
  });
  it('round body honours its at offset (cylinder centered at offset)', () => {
    const p = { id: 'body', type: 'body', at: { x: 2, y: 1 }, size: { w: 2, h: 2 }, params: { plan: 'round', levels: 1, roof: 'domed' }, features: [] } as const;
    const prims = bodyPartType.toPrims(p as any, ctx);
    const cyl = prims.find(pr => pr.prim === 'cylinder');
    expect(cyl && cyl.prim === 'cylinder' ? cyl.center : null).toEqual([3, 2]);
  });
});

describe('body part — material maps', () => {
  it('maps wall + roof + roof-kind tables', () => {
    expect(WALL_MAT.timber).toBe('timber');
    expect(ROOF_MAT.thatch).toBe('thatch');
    expect(ROOF_KIND.conical).toBe('pyramidal');
  });
});
