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
  it('domed cap embeds: dome centre snaps to the cylinder top (lower hemisphere inside the wall)', () => {
    const prims = bodyPartType.toPrims(part({ plan: 'round', levels: 1, roof: 'domed' }, { w: 2, h: 2 }), ctx);
    const cyl = prims.find(p => p.prim === 'cylinder');
    const dome = prims.find(p => p.prim === 'ellipsoid');
    if (cyl?.prim !== 'cylinder' || dome?.prim !== 'ellipsoid') throw new Error('expected cylinder + ellipsoid');
    const wallTop = cyl.baseZ + cyl.height;           // top of the wall
    const domeCentreZ = dome.baseZ + dome.radii[2];   // solidEllipsoid centres at baseZ + radii[2]
    expect(domeCentreZ).toBeCloseTo(wallTop);         // centre snapped to the wall top, not floating above
  });
  it('round body with a smoke vent bores an open skylight (toono) through the dome apex', () => {
    const p = { id: 'body', type: 'body', at: { x: 0, y: 0 }, size: { w: 2, h: 2 },
      params: { plan: 'round', levels: 1, roof: 'domed' },
      features: [{ id: 'v', type: 'vent', params: { kind: 'smokehole' } }] } as unknown as ResolvedPart;
    const prims = bodyPartType.toPrims(p, ctx);
    // No extra prim — the hole is carved into the dome, not added on top.
    expect(prims.map(pr => pr.prim)).toEqual(['cylinder', 'ellipsoid']);
    const dome = prims[1];
    if (dome.prim !== 'ellipsoid') throw new Error('expected dome ellipsoid');
    expect(dome.bore).toBeDefined();
    expect(dome.bore!.radius).toBeGreaterThan(0);
    expect(dome.bore!.depth).toBeGreaterThan(0);
  });
  it('round body without a vent has no bored skylight', () => {
    const prims = bodyPartType.toPrims(part({ plan: 'round', levels: 1, roof: 'domed' }, { w: 2, h: 2 }), ctx);
    const dome = prims[1];
    expect(dome.prim === 'ellipsoid' && dome.bore).toBeUndefined();
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
  it('STOREY equals the metric storey (1.35 cube-units)', async () => {
    const { STOREY } = await import('@/assetgen/geometry/building');
    expect(STOREY).toBeCloseTo(1.35);
  });
  it('storeyM scales rendered wall height (taller storeyM -> taller building prim)', () => {
    const tall = bodyPartType.toPrims(part({ plan: 'rect', levels: 1, roof: 'flat', storeyM: 4 }), ctx);
    const base = bodyPartType.toPrims(part({ plan: 'rect', levels: 1, roof: 'flat', storeyM: 2 }), ctx);
    const tw = tall[0]; const bw = base[0];
    if (tw.prim !== 'building' || bw.prim !== 'building') throw new Error('expected building prims');
    expect(tw.wings[0].storeyHeight!).toBeGreaterThan(bw.wings[0].storeyHeight! * 1.5);  // 2.0 vs 1.0 cube-units
    expect(tw.wings[0].storeyHeight!).toBeCloseTo(2.0);   // mToTiles(4)
    expect(bw.wings[0].storeyHeight!).toBeCloseTo(1.0);   // mToTiles(2)
  });
  it('storeyM unset -> wing uses the standard metric storey', () => {
    const prims = bodyPartType.toPrims(part({ plan: 'rect', levels: 1, roof: 'gable' }), ctx);
    const b = prims[0];
    if (b.prim !== 'building') throw new Error('expected building');
    expect(b.wings[0].storeyHeight).toBeCloseTo(1.35);  // STOREY
  });
});

describe('body part — param schema (metric)', () => {
  it('body param schema no longer carries heightPerLevel (dead param removed)', () => {
    expect(bodyPartType.paramSchema.heightPerLevel).toBeUndefined();
  });
  it('body param schema gains an optional metric storeyM override', () => {
    expect(bodyPartType.paramSchema.storeyM).toBeDefined();
  });
});

describe('body part — material maps', () => {
  it('maps wall + roof + roof-kind tables', () => {
    expect(WALL_MAT.timber).toBe('timber');
    expect(ROOF_MAT.thatch).toBe('thatch');
    expect(ROOF_KIND.conical).toBe('pyramidal');
  });
});
