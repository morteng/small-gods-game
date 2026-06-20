// tests/unit/anchor-fillet.test.ts
import { describe, it, expect } from 'vitest';
import { filletPath, hermite, filletApproach } from '@/world/anchor-fillet';

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

describe('filletPath — line→arc', () => {
  it('honours both endpoints', () => {
    const p = filletPath({ x: 0, y: 0 }, [1, 0], { x: 5, y: 5 }, [0, 1]);
    expect(dist(p[0], { x: 0, y: 0 })).toBeLessThan(1e-6);
    expect(dist(p[p.length - 1], { x: 5, y: 5 })).toBeLessThan(1e-6);
  });

  it('a 90° turn is a constant-radius arc (all points equidistant from centre (0,5))', () => {
    // p0=(0,0) heading +x; arrives at p1=(5,5) heading +y. I=(5,0), centre=(0,5), r=5.
    const p = filletPath({ x: 0, y: 0 }, [1, 0], { x: 5, y: 5 }, [0, 1], { step: 0.5 });
    const C = { x: 0, y: 5 };
    for (const q of p) expect(dist(q, C)).toBeCloseTo(5, 4);
    expect(p.length).toBeGreaterThan(8); // sampled, not just endpoints
  });

  it('leaves p0 tangent to t0', () => {
    const p = filletPath({ x: 0, y: 0 }, [1, 0], { x: 5, y: 5 }, [0, 1]);
    const dx = p[1].x - p[0].x, dy = p[1].y - p[0].y;
    const m = Math.hypot(dx, dy);
    // First chord heading ≈ +x (small chord-vs-tangent slack near the arc start).
    expect(dx / m).toBeGreaterThan(0.98);
    expect(Math.abs(dy / m)).toBeLessThan(0.15);
  });

  it('collinear rays give a straight segment', () => {
    const p = filletPath({ x: 0, y: 0 }, [1, 0], { x: 10, y: 0 }, [1, 0], { step: 1 });
    for (const q of p) expect(Math.abs(q.y)).toBeLessThan(1e-6);
  });

  it('falls back to a smooth curve for an S-curve (no single forward arc)', () => {
    // Rays diverge — intersection is behind a profile → Hermite fallback, still endpoint-exact.
    const p = filletPath({ x: 0, y: 0 }, [1, 0], { x: 5, y: 2 }, [1, 0]);
    expect(dist(p[0], { x: 0, y: 0 })).toBeLessThan(1e-6);
    expect(dist(p[p.length - 1], { x: 5, y: 2 })).toBeLessThan(1e-6);
    expect(p.length).toBeGreaterThan(2);
  });
});

describe('filletApproach', () => {
  it('keeps the head, re-grafts the tail to arrive into -facing at the target', () => {
    // Straight road heading +x along y=0; door target at (10.2, 0) facing +x (outward from a
    // building to the east). Road should arrive heading +x into the door.
    const road = [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 6, y: 0 }, { x: 9, y: 0 }];
    const out = filletApproach(road, { x: 10.2, y: 0 }, [1, 0], { step: 0.5, graftBack: 3 });
    expect(out[0]).toEqual({ x: 0, y: 0 });          // head untouched
    const end = out[out.length - 1];
    expect(Math.hypot(end.x - 10.2, end.y - 0)).toBeLessThan(1e-6); // ends at the door
  });

  it('returns the polyline unchanged when too short to graft', () => {
    const road = [{ x: 0, y: 0 }];
    expect(filletApproach(road, { x: 1, y: 1 }, [1, 0])).toEqual(road);
  });
});

describe('hermite', () => {
  it('hits both endpoints', () => {
    const p = hermite({ x: 1, y: 1 }, [1, 0], { x: 4, y: 3 }, [0, 1], 10);
    expect(dist(p[0], { x: 1, y: 1 })).toBeLessThan(1e-6);
    expect(dist(p[p.length - 1], { x: 4, y: 3 })).toBeLessThan(1e-6);
  });
});
