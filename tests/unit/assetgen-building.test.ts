// tests/unit/assetgen-building.test.ts
import { describe, it, expect } from 'vitest';
import { occupancy, cellRect, wingRect, type Wing } from '@/assetgen/geometry/building';

describe('building footprint helpers', () => {
  it('occupancy collects every cell of every wing', () => {
    const occ = occupancy([{ x: 0, y: 0, w: 2, h: 1 }]);
    expect([...occ].sort()).toEqual(['0,0', '1,0']);
  });

  it('cellRect insets exterior sides but keeps shared sides flush', () => {
    const occ = occupancy([{ x: 0, y: 0, w: 2, h: 1 }]); // cells (0,0)(1,0)
    const left = cellRect(occ, 0, 0);
    expect(left.x0).toBeCloseTo(0.32);  // west is exterior → inset
    expect(left.x1).toBeCloseTo(1);     // east borders (1,0) → flush
  });

  it('wingRect insets only where the wing meets open space', () => {
    const occ = occupancy([{ x: 0, y: 0, w: 1, h: 1 }]);
    const r = wingRect(occ, { x: 0, y: 0, w: 1, h: 1 });
    expect(r.x0).toBeCloseTo(0.32);
    expect(r.x1).toBeCloseTo(0.68);
  });
});
