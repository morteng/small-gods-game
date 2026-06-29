import { describe, it, expect } from 'vitest';
import {
  ORIENTATIONS, yawForOrientation, rotateFootprint, rotateCell, rotateFacing, orientationForFacing,
  type Orientation,
} from '@/blueprint/orientation';

describe('blueprint orientation — quarter-turn helpers', () => {
  it('yaw is +π/2 per quarter turn', () => {
    expect(yawForOrientation(0)).toBe(0);
    expect(yawForOrientation(1)).toBeCloseTo(Math.PI / 2);
    expect(yawForOrientation(2)).toBeCloseTo(Math.PI);
    expect(yawForOrientation(3)).toBeCloseTo(3 * Math.PI / 2);
  });

  it('footprint dims swap on odd turns only', () => {
    expect(rotateFootprint(4, 2, 0)).toEqual({ w: 4, h: 2 });
    expect(rotateFootprint(4, 2, 1)).toEqual({ w: 2, h: 4 });
    expect(rotateFootprint(4, 2, 2)).toEqual({ w: 4, h: 2 });
    expect(rotateFootprint(4, 2, 3)).toEqual({ w: 2, h: 4 });
  });

  it('orientation 0 is the identity for cells and facings', () => {
    expect(rotateCell(2, 1, 4, 3, 0)).toEqual([2, 1]);
    expect(rotateFacing(0, 1, 0)).toEqual([0, 1]);
  });

  it('a single quarter-turn maps (x,y) → (h-1-y, x)', () => {
    // 4×3 footprint, cell (2,1): h=3 → (3-1-1, 2) = (1, 2) in the rotated 3×4 footprint.
    expect(rotateCell(2, 1, 4, 3, 1)).toEqual([1, 2]);
  });

  it('four quarter-turns return every cell to itself', () => {
    const w = 4, h = 3;
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) {
        expect(rotateCell(x, y, w, h, 4 as unknown as Orientation)).toEqual([x, y]);
      }
    }
  });

  it('rotated cells stay inside the rotated footprint and are a bijection', () => {
    const w = 5, h = 2;
    for (const o of ORIENTATIONS) {
      const { w: rw, h: rh } = rotateFootprint(w, h, o);
      const seen = new Set<string>();
      for (let x = 0; x < w; x++) {
        for (let y = 0; y < h; y++) {
          const [rx, ry] = rotateCell(x, y, w, h, o);
          expect(rx).toBeGreaterThanOrEqual(0);
          expect(ry).toBeGreaterThanOrEqual(0);
          expect(rx).toBeLessThan(rw);
          expect(ry).toBeLessThan(rh);
          seen.add(`${rx},${ry}`);
        }
      }
      expect(seen.size).toBe(w * h); // no two cells collide
    }
  });

  it('facing rotates CW: south → west → north → east', () => {
    expect(rotateFacing(0, 1, 1)).toEqual([-1, 0]);  // south → west
    expect(rotateFacing(0, 1, 2)).toEqual([-0, -1]); // south → north
    expect(rotateFacing(0, 1, 3)).toEqual([1, -0]);  // south → east
  });

  it('cell and facing rotation share one sense (a door cell stays on its facing edge)', () => {
    // Canonical south door on the bottom edge of a 3×3 footprint: cell (1,2), facing [0,1].
    // After one turn the facing is west [-1,0]; the rotated cell must sit on the west edge (x=0).
    const o: Orientation = 1;
    const [rx] = rotateCell(1, 2, 3, 3, o);
    const [fx] = rotateFacing(0, 1, o);
    expect(fx).toBe(-1);
    expect(rx).toBe(0); // west edge
  });

  it('orientationForFacing turns the canonical door to face the road', () => {
    // Canonical door faces south [0,1]. To front a road to the WEST [-1,0] we need o=1.
    expect(orientationForFacing(0, 1, -1, 0)).toBe(1);
    expect(orientationForFacing(0, 1, 0, -1)).toBe(2);  // road north
    expect(orientationForFacing(0, 1, 1, 0)).toBe(3);   // road east
    expect(orientationForFacing(0, 1, 0, 1)).toBe(0);   // road south → canonical
  });

  it('orientationForFacing returns 0 for a zero desired direction', () => {
    expect(orientationForFacing(0, 1, 0, 0)).toBe(0);
  });

  it('the chosen orientation actually points the door at the road', () => {
    const cf: [number, number] = [0, 1];
    for (const road of [[1, 0], [-1, 0], [0, 1], [0, -1]] as [number, number][]) {
      const o = orientationForFacing(cf[0], cf[1], road[0], road[1]);
      const [rx, ry] = rotateFacing(cf[0], cf[1], o);
      // normalise -0 → 0 before comparing direction
      expect([rx + 0, ry + 0]).toEqual(road);
    }
  });
});
