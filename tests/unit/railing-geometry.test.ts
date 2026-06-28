// tests/unit/railing-geometry.test.ts — the kit's Railing family (one edge-profile run).
// Pins the five styles' prim shape + that balusters/pickets are Columns (kit reuses itself),
// and that a run lays along the requested axis for its full length.
import { describe, it, expect } from 'vitest';
import { railingPrims } from '@/blueprint/parts/railing';
import type { Vec3 } from '@/assetgen/types';

const AT: Vec3 = [0, 0, 0];

describe('railingPrims', () => {
  it('parapet is a single solid box spanning the run length', () => {
    const ps = railingPrims(AT, { style: 'parapet', lengthU: 6, axis: 'x', material: 'stone' });
    expect(ps.length).toBe(1);
    expect(ps[0].prim).toBe('box');
    expect((ps[0] as any).size[0]).toBeCloseTo(6, 6);   // runs the full length along x
  });

  it('coping is a low capping course (shorter than a full parapet)', () => {
    const cop = railingPrims(AT, { style: 'coping', lengthU: 4, axis: 'x', heightU: 1, material: 'stone' })[0] as any;
    const par = railingPrims(AT, { style: 'parapet', lengthU: 4, axis: 'x', heightU: 1, material: 'stone' })[0] as any;
    expect(cop.size[2]).toBeLessThan(par.size[2]);
  });

  it('balustrade is two rails + Column balusters between them', () => {
    const ps = railingPrims(AT, { style: 'balustrade', lengthU: 6, axis: 'x', material: 'stone' });
    const boxes = ps.filter(p => p.prim === 'box');
    const cols = ps.filter(p => p.prim === 'column');
    expect(boxes.length).toBe(2);                       // bottom + top rail
    expect(cols.length).toBeGreaterThanOrEqual(3);      // balusters
    expect((cols[0] as any).shape).toBe('square');      // a baluster IS a square column
  });

  it('picket is a top rail + closely spaced pickets (more than a balustrade has balusters)', () => {
    const pick = railingPrims(AT, { style: 'picket', lengthU: 6, axis: 'x', material: 'timber' });
    const bal = railingPrims(AT, { style: 'balustrade', lengthU: 6, axis: 'x', material: 'timber' });
    const pCols = pick.filter(p => p.prim === 'column').length;
    const bCols = bal.filter(p => p.prim === 'column').length;
    expect(pCols).toBeGreaterThan(bCols);               // pickets are denser
  });

  it('crenellated lays alternating merlons over a base course (multiple boxes)', () => {
    const ps = railingPrims(AT, { style: 'crenellated', lengthU: 9, axis: 'x', material: 'stone' });
    const boxes = ps.filter(p => p.prim === 'box');
    expect(boxes.length).toBeGreaterThanOrEqual(3);     // several merlons + a base course
  });

  it('runs along the y axis when asked (length on the y extent)', () => {
    const ps = railingPrims(AT, { style: 'parapet', lengthU: 5, axis: 'y', material: 'stone' });
    expect((ps[0] as any).size[1]).toBeCloseTo(5, 6);   // length is on y now
  });
});
