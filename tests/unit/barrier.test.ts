import { describe, it, expect } from 'vitest';
import { barrierFootprintTiles, type BarrierRun } from '@/world/barrier';

const run = (over: Partial<BarrierRun> = {}): BarrierRun => ({
  kind: 'wall', path: [[0, 0], [4, 0]], height: 3, thickness: 1, material: 'stone', gates: [], ...over,
});

describe('barrierFootprintTiles', () => {
  it('rasterizes a straight horizontal run into contiguous blocking cells', () => {
    const { blocking, gate } = barrierFootprintTiles(run());
    expect(gate).toHaveLength(0);
    expect(blocking).toEqual(expect.arrayContaining([[0, 0], [1, 0], [2, 0], [3, 0]]));
  });

  it('excludes gate-span cells from blocking and reports them as gate cells', () => {
    const { blocking, gate } = barrierFootprintTiles(run({ gates: [{ t: 2, width: 1 }] }));
    expect(blocking.some(([x]) => x === 2)).toBe(false);
    expect(gate.some(([x]) => x === 2)).toBe(true);
  });

  it('rasterizes a diagonal run', () => {
    const { blocking } = barrierFootprintTiles(run({ path: [[0, 0], [3, 3]] }));
    expect(blocking).toEqual(expect.arrayContaining([[0, 0], [1, 1], [2, 2]]));
  });
});
