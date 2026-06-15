import { describe, it, expect } from 'vitest';
import { barrierItems } from '@/render/iso/iso-barrier';
import type { Entity } from '@/core/types';
import type { BarrierRun } from '@/world/barrier';

const run = (over: Partial<BarrierRun> = {}): Entity => ({
  id: 'b1', kind: 'wall_run', x: 2, y: 0, tags: ['barrier','obstacle'],
  properties: { barrier: { kind:'wall', path:[[0,0],[4,0]], height:3, thickness:1, material:'stone', gates:[], ...over } as BarrierRun },
});

describe('barrierItems', () => {
  it('emits items without throwing', () => {
    let items;
    expect(() => { items = barrierItems(run(), { originX: 0, originY: 0 }); }).not.toThrow();
    expect(items!.length).toBeGreaterThan(0);
  });

  it('a gate reduces the number of wall slab items', () => {
    const a = barrierItems(run(), { originX: 0, originY: 0 });
    const b = barrierItems(run({ gates: [{ t: 2, width: 1.5 }] }), { originX: 0, originY: 0 });
    expect(b.length).toBeLessThan(a.length);
  });

  it('returns an empty list for a degenerate (<2 point) path', () => {
    expect(barrierItems(run({ path: [[0, 0]] }), { originX: 0, originY: 0 })).toEqual([]);
  });
});
