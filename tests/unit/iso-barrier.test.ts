import { describe, it, expect } from 'vitest';
import { barrierItems, barrierSlabs } from '@/render/iso/iso-barrier';
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

describe('barrierSlabs (per-segment y-sort)', () => {
  it('splits a straight run into per-unit slabs, each anchored along the path', () => {
    const slabs = barrierSlabs(run({ path: [[0, 0], [4, 0]] }), { originX: 0, originY: 0 });
    // 4 unit steps over a length-4 path
    expect(slabs.length).toBe(4);
    const xs = slabs.map((s) => Math.floor(s.wx));
    expect(xs).toEqual([0, 1, 2, 3]); // monotonically advancing depth anchors
    expect(slabs.every((s) => s.wy === 0)).toBe(true);
  });

  it('anchors advance along a diagonal run (distinct iso depths)', () => {
    const slabs = barrierSlabs(run({ path: [[0, 0], [3, 3]] }), { originX: 0, originY: 0 });
    const depths = slabs.map((s) => Math.floor(s.wx) + Math.floor(s.wy));
    // depth (tx+ty) must be non-decreasing as we walk the run
    for (let i = 1; i < depths.length; i++) expect(depths[i]).toBeGreaterThanOrEqual(depths[i - 1]);
  });

  it('posts add one extra slab per path vertex', () => {
    const plain = barrierSlabs(run({ path: [[0, 0], [4, 0]] }), { originX: 0, originY: 0 });
    const posted = barrierSlabs(run({ path: [[0, 0], [4, 0]], posts: true }), { originX: 0, originY: 0 });
    expect(posted.length).toBe(plain.length + 2); // 2 vertices
  });

  it('flattened barrierItems equals the concatenated slab items', () => {
    const e = run({ path: [[0, 0], [4, 0]], crenellated: true });
    const flat = barrierItems(e, { originX: 0, originY: 0 });
    const concat = barrierSlabs(e, { originX: 0, originY: 0 }).flatMap((s) => s.items);
    expect(flat).toEqual(concat);
  });
});
