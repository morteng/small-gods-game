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
});

describe('leafBox', () => {
  it('south leaf never protrudes past the wall plane', () => {
    const l = leafBox({ face: 'south', t: 0.5, sill: 0, halfW: 0.2, height: 0.85, depth: 0.3 }, part(0, 0, 2, 2));
    const maxY = l.at[1] + l.size[1];
    expect(maxY).toBeLessThanOrEqual(2);   // ≤ wall plane (no protrusion)
  });
});

describe('FACE_FACING', () => {
  it('maps faces to outward unit vectors', () => {
    expect(FACE_FACING.south).toEqual([0, 1]);
    expect(FACE_FACING.west).toEqual([-1, 0]);
  });
});
