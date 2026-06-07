// tests/unit/assetgen-building.test.ts
import { describe, it, expect } from 'vitest';
import { occupancy, cellRect, wingRect, type Wing } from '@/assetgen/geometry/building';
import { wallFacets } from '@/assetgen/geometry/building';
import { frontFacing } from '@/assetgen/render/projection';

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

describe('wall facets', () => {
  it('a single cell emits 4 walls + 1 top cap', () => {
    const wings: Wing[] = [{ x: 0, y: 0, w: 1, h: 1 }];
    const f = wallFacets(wings, occupancy(wings), 'plaster');
    expect(f).toHaveLength(5);
    expect(f.filter(x => x.normal[2] === 1)).toHaveLength(1); // one top cap
  });

  it('culls the shared interior wall between two abutting cells', () => {
    const wings: Wing[] = [{ x: 0, y: 0, w: 2, h: 1 }];
    const f = wallFacets(wings, occupancy(wings), 'plaster');
    // 2 cells: each has 3 exterior walls (shared side dropped) + 1 top = 4; total 8
    expect(f).toHaveLength(8);
  });

  it('raises walls to storey height', () => {
    const wings: Wing[] = [{ x: 0, y: 0, w: 1, h: 1, storeys: 2 }];
    const f = wallFacets(wings, occupancy(wings), 'plaster');
    const maxZ = Math.max(...f.flatMap(x => x.pts.map(p => p[2])));
    expect(maxZ).toBeCloseTo(2 * 2.1);
  });

  it('keeps at least one camera-facing wall after projection cull', () => {
    const wings: Wing[] = [{ x: 0, y: 0, w: 1, h: 1 }];
    const f = wallFacets(wings, occupancy(wings), 'plaster');
    expect(f.filter(x => frontFacing(x.normal)).length).toBeGreaterThanOrEqual(2);
  });
});
