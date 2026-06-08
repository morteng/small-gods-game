// tests/unit/blueprint-wing-prim-parts.test.ts
import { describe, it, expect } from 'vitest';
import { wingPartType } from '@/blueprint/parts/wing';
import { primPartType } from '@/blueprint/parts/prim';
import type { ResolvedPart } from '@/blueprint/types';

const ctx = { materials: { walls: 'stone', roof: 'tile' }, footprint: { w: 5, h: 5 } };

describe('wing part', () => {
  it('emits one building prim wing at its offset', () => {
    const p: ResolvedPart = { id: 'ell', type: 'wing', at: { x: 2, y: 0 }, size: { w: 2, h: 3 }, params: { levels: 1, roof: 'gable' }, features: [] };
    const prims = wingPartType.toPrims(p, ctx);
    expect(prims).toHaveLength(1);
    if (prims[0].prim === 'building') expect(prims[0].wings[0]).toMatchObject({ x: 2, y: 0, w: 2, h: 3 });
  });
  it('blocks its own cells', () => {
    const p: ResolvedPart = { id: 'ell', type: 'wing', at: { x: 2, y: 0 }, size: { w: 1, h: 2 }, params: { levels: 1, roof: 'gable' }, features: [] };
    expect(wingPartType.toCollision(p, ctx).sort()).toEqual([[2, 0], [2, 1]]);
  });
});

describe('prim escape part', () => {
  it('passes a raw assetgen prim through unchanged', () => {
    const raw = { prim: 'box', at: [0, 0, 0], size: [1, 1, 1], material: 'stone' };
    const p: ResolvedPart = { id: 'x', type: 'prim', at: { x: 0, y: 0 }, size: { w: 1, h: 1 }, params: { prim: raw }, features: [] };
    expect(primPartType.toPrims(p, ctx)).toEqual([raw]);
  });
});
