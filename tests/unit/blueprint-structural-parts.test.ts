// tests/unit/blueprint-structural-parts.test.ts
import { describe, it, expect } from 'vitest';
import { towerPartType, porchPartType, chimneyPartType } from '@/blueprint/parts/structural';
import type { ResolvedPart } from '@/blueprint/types';

const ctx = { materials: { walls: 'stone', roof: 'slate' }, footprint: { w: 4, h: 4 } };
const rp = (type: string, params: Record<string, unknown>, at = { x: 0, y: 0 }, size = { w: 1, h: 1 }): ResolvedPart =>
  ({ id: type, type, at, size, params, features: [] });

describe('structural parts', () => {
  it('square tower → a box prim', () => {
    const prims = towerPartType.toPrims(rp('tower', { levels: 3, shape: 'square', roof: 'pyramidal' }, { x: 0, y: 0 }, { w: 1, h: 1 }), ctx);
    expect(prims.some(p => p.prim === 'box')).toBe(true);
  });
  it('round tower → a cylinder prim', () => {
    const prims = towerPartType.toPrims(rp('tower', { levels: 3, shape: 'round', roof: 'conical' }, { x: 0, y: 0 }, { w: 2, h: 2 }), ctx);
    expect(prims.some(p => p.prim === 'cylinder')).toBe(true);
  });
  it('porch → a low box prim', () => {
    const prims = porchPartType.toPrims(rp('porch', { depth: 1 }, { x: 1, y: 3 }, { w: 2, h: 1 }), ctx);
    expect(prims[0].prim).toBe('box');
  });
  it('chimney → a thin box prim and blocks no cells', () => {
    const p = rp('chimney', { height: 1.5 }, { x: 1, y: 0 }, { w: 1, h: 1 });
    expect(chimneyPartType.toPrims(p, ctx)[0].prim).toBe('box');
    expect(chimneyPartType.toCollision(p, ctx)).toEqual([]);
  });
});
