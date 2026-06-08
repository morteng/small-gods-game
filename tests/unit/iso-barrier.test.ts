import { describe, it, expect } from 'vitest';
import { drawIsoBarrier } from '@/render/iso/iso-barrier';
import type { Entity } from '@/core/types';
import type { BarrierRun } from '@/world/barrier';

function mockCtx() {
  const calls = { fill: 0 };
  return { calls, ctx: new Proxy({}, { get: (_t, k) => {
    if (k === 'fill') return () => { calls.fill++; };
    if (k === 'fillStyle') return '';
    return () => {};
  }}) as unknown as CanvasRenderingContext2D };
}
const run = (over: Partial<BarrierRun> = {}): Entity => ({
  id: 'b1', kind: 'wall_run', x: 2, y: 0, tags: ['barrier','obstacle'],
  properties: { barrier: { kind:'wall', path:[[0,0],[4,0]], height:3, thickness:1, material:'stone', gates:[], ...over } as BarrierRun },
});

describe('drawIsoBarrier', () => {
  it('draws without throwing', () => {
    const { ctx } = mockCtx();
    expect(() => drawIsoBarrier(ctx, run(), { originX: 0, originY: 0 })).not.toThrow();
  });
  it('a gate reduces the number of wall fills', () => {
    const a = mockCtx(); drawIsoBarrier(a.ctx, run(), { originX: 0, originY: 0 });
    const b = mockCtx(); drawIsoBarrier(b.ctx, run({ gates: [{ t: 2, width: 1.5 }] }), { originX: 0, originY: 0 });
    expect(b.calls.fill).toBeLessThan(a.calls.fill);
  });
});
