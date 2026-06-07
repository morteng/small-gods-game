// tests/unit/assetgen-building.test.ts
import { describe, it, expect } from 'vitest';
import { occupancy, cellRect, wingRect, type Wing } from '@/assetgen/geometry/building';
import { wallFacets } from '@/assetgen/geometry/building';
import { frontFacing } from '@/assetgen/render/projection';
import { roofFacets } from '@/assetgen/geometry/building';

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

describe('roof facets', () => {
  const occ1 = occupancy([{ x: 0, y: 0, w: 3, h: 2 }]);

  it('gable roof = 2 slopes + 2 closed ends, with a ridge', () => {
    const { facets, meta } = roofFacets(occ1, { x: 0, y: 0, w: 3, h: 2, roof: 'gable' }, 'tile');
    expect(facets).toHaveLength(4);             // 2 slopes + 2 gable ends (no open notch)
    expect(meta.ridge).toBeDefined();
    expect(meta.apex).toBeUndefined();
  });

  it('gable ridge runs along the longer axis', () => {
    const { meta } = roofFacets(occ1, { x: 0, y: 0, w: 3, h: 2, roof: 'gable' }, 'tile');
    const [a, b] = meta.ridge!;
    expect(Math.abs(a[0] - b[0])).toBeGreaterThan(Math.abs(a[1] - b[1])); // spans x (the long axis)
  });

  it('hip roof = 4 triangles meeting an apex', () => {
    const { facets, meta } = roofFacets(occ1, { x: 0, y: 0, w: 3, h: 2, roof: 'hip' }, 'tile');
    expect(facets).toHaveLength(4);
    for (const f of facets) expect(f.pts).toHaveLength(3);
    expect(meta.apex).toBeDefined();
  });

  it('flat roof emits no roof facets (cell tops cover it)', () => {
    const { facets } = roofFacets(occ1, { x: 0, y: 0, w: 3, h: 2, roof: 'flat' }, 'tile');
    expect(facets).toHaveLength(0);
  });
});
