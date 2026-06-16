// tests/unit/blueprint-wall-geometry.test.ts
import { describe, it, expect } from 'vitest';
import { faceCell, apertureToBox, leafBox, FACE_FACING } from '@/blueprint/wall-geometry';
import type { ResolvedPart } from '@/blueprint/types';

const part = (x: number, y: number, w: number, h: number): ResolvedPart => ({
  id: 'body', type: 'body', at: { x, y }, size: { w, h }, params: {}, features: [],
});

describe('faceCell', () => {
  it('south edge midpoint of a 2x2 at origin is the south row', () => {
    expect(faceCell(part(0, 0, 2, 2), 'south')).toEqual([1, 1]);
  });
  it('west edge midpoint hugs x=origin', () => {
    expect(faceCell(part(0, 0, 2, 2), 'west')).toEqual([0, 1]);
  });
});

describe('apertureToBox', () => {
  it('south aperture sits on the south wall plane and pokes outward by EPS', () => {
    const b = apertureToBox({ face: 'south', t: 0.5, sill: 0, halfW: 0.2, height: 0.85, depth: 0.3 }, part(0, 0, 2, 2));
    // wall plane y = 2; box spans [2-0.3, 2+0.02]
    expect(b.at[1]).toBeCloseTo(1.7, 5);
    expect(b.at[1] + b.size[1]).toBeCloseTo(2.02, 5);
    expect(b.size[0]).toBeCloseTo(0.4, 5);   // 2*halfW
    expect(b.size[2]).toBeCloseTo(0.85, 5);  // height
  });

  it('east aperture cuts the east wall plane along x (different axis than south)', () => {
    const b = apertureToBox({ face: 'east', t: 0.5, sill: 0, halfW: 0.2, height: 0.85, depth: 0.3 }, part(0, 0, 2, 2));
    // wall plane x = 2; box spans x∈[2-0.3, 2+0.02], width 2*halfW along y
    expect(b.at[0]).toBeCloseTo(1.7, 5);
    expect(b.at[0] + b.size[0]).toBeCloseTo(2.02, 5);
    expect(b.size[1]).toBeCloseTo(0.4, 5);   // 2*halfW along the y run
    expect(b.size[2]).toBeCloseTo(0.85, 5);  // height
  });
});

describe('leafBox', () => {
  it('south leaf never protrudes past the wall plane', () => {
    const l = leafBox({ face: 'south', t: 0.5, sill: 0, halfW: 0.2, height: 0.85, depth: 0.3 }, part(0, 0, 2, 2));
    const maxY = l.at[1] + l.size[1];
    expect(maxY).toBeLessThanOrEqual(2);   // ≤ wall plane (no protrusion)
  });

  it('east leaf never protrudes past the east wall plane (max-x ≤ plane)', () => {
    const l = leafBox({ face: 'east', t: 0.5, sill: 0, halfW: 0.2, height: 0.85, depth: 0.3 }, part(0, 0, 2, 2));
    expect(l.at[0] + l.size[0]).toBeLessThanOrEqual(2);   // east plane x = 2
  });

  it('west leaf never protrudes past the west wall plane (min-x ≥ plane)', () => {
    const l = leafBox({ face: 'west', t: 0.5, sill: 0, halfW: 0.2, height: 0.85, depth: 0.3 }, part(0, 0, 2, 2));
    expect(l.at[0]).toBeGreaterThanOrEqual(0);   // west plane x = 0
  });
});

describe('multi-wing (L-plan) opening placement', () => {
  // L-plan body: wings [{0,0,3,2},{0,0,2,3}] — its bbox south edge is y=3, but for x>2
  // the actual south wall is the set-back step at y=2 (the re-entrant notch). An opening
  // there must snap to the real wall, not float on the bbox edge.
  const lPart = (): ResolvedPart => ({
    id: 'body', type: 'body', at: { x: 0, y: 0 }, size: { w: 3, h: 3 },
    params: { plan: 'L' }, features: [],
  });

  it('a south opening past the frontage step lands on the set-back wall (y=2), not the bbox edge (y=3)', () => {
    const s = { face: 'south' as const, t: 0.75, sill: 0, halfW: 0.18, height: 0.9, depth: 0.18 };
    const b = apertureToBox(s, lPart());          // along-pos x = 0.75*3 = 2.25 (only wing0 spans it)
    expect(b.at[1] + b.size[1]).toBeCloseTo(2.02, 5);   // wall plane y=2 (+EPS), NOT 3
  });

  it('a south opening on the frontage (x<2) still uses the front wall (y=3)', () => {
    const s = { face: 'south' as const, t: 0.25, sill: 0, halfW: 0.18, height: 0.9, depth: 0.18 };
    const b = apertureToBox(s, lPart());          // along-pos x = 0.75 (wing1 spans it, edge y=3)
    expect(b.at[1] + b.size[1]).toBeCloseTo(3.02, 5);
  });

  it('a rect (single-wing) body is unaffected — uses the bbox edge', () => {
    const s = { face: 'south' as const, t: 0.75, sill: 0, halfW: 0.18, height: 0.9, depth: 0.18 };
    const b = apertureToBox(s, part(0, 0, 3, 3));   // params {} → no plan → bbox y=3
    expect(b.at[1] + b.size[1]).toBeCloseTo(3.02, 5);
  });
});

describe('FACE_FACING', () => {
  it('maps faces to outward unit vectors', () => {
    expect(FACE_FACING.south).toEqual([0, 1]);
    expect(FACE_FACING.west).toEqual([-1, 0]);
  });
});
