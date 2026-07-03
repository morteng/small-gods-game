// tests/unit/anchor-fillet.test.ts
import { describe, it, expect } from 'vitest';
import { filletPath, hermite, filletApproach, type Vec } from '@/world/anchor-fillet';

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

describe('filletPath — radius clamp (WP-Q #3)', () => {
  // A shallow (~8.6°) turn over a moderate chord needs a large-radius arc (r = T/tan(θ/2)
  // blows up as θ→0 for any fixed T>0) — StreetGen's "short segment forces an oversized loop"
  // pitfall. Without a cap the fillet still finds a valid forward arc (bulges visibly off the
  // chord); with a small `maxRadius` it should give up on the arc and arrive on the straight
  // chord instead.
  const p0 = { x: 0, y: 0 };
  const p1 = { x: 10, y: 1 };
  const t0: Vec = [1, 0];
  const t1: Vec = [Math.cos(0.15), Math.sin(0.15)];

  /** Perpendicular distance from q to the line through p0→p1. */
  function distToChord(q: { x: number; y: number }): number {
    const dx = p1.x - p0.x, dy = p1.y - p0.y, m = Math.hypot(dx, dy);
    return Math.abs((q.x - p0.x) * dy - (q.y - p0.y) * dx) / m;
  }

  it('an unclamped shallow turn bulges off the straight chord', () => {
    const wide = filletPath(p0, t0, p1, t1, { step: 0.5 });
    const maxDev = Math.max(...wide.map(distToChord));
    expect(maxDev).toBeGreaterThan(0.05);
  });

  it('a tight maxRadius skips the arc and arrives on the straight chord', () => {
    const clamped = filletPath(p0, t0, p1, t1, { step: 0.5, maxRadius: 5 });
    expect(dist(clamped[0], p0)).toBeLessThan(1e-6);
    expect(dist(clamped[clamped.length - 1], p1)).toBeLessThan(1e-6);
    const maxDev = Math.max(...clamped.map(distToChord));
    expect(maxDev).toBeLessThan(1e-6);
  });

  it('filletApproach derives a radius cap from the available approach length', () => {
    // A very short graft-back run (1 tile) feeding the same shallow turn should also clamp
    // automatically (no explicit maxRadius passed) — the default ties the cap to the shorter
    // incident run, so a short approach never hosts an oversized sweep.
    const road = [{ x: -1, y: 0 }, p0];
    const out = filletApproach(road, p1, [-t1[0], -t1[1]], { step: 0.5, graftBack: 1 });
    const start = out[0], end = out[out.length - 1];
    const dx = end.x - start.x, dy = end.y - start.y, m = Math.hypot(dx, dy);
    const maxDev = Math.max(...out.map((q) => Math.abs((q.x - start.x) * dy - (q.y - start.y) * dx) / m));
    expect(maxDev).toBeLessThan(1e-6);
  });
});

describe('hermite', () => {
  it('hits both endpoints', () => {
    const p = hermite({ x: 1, y: 1 }, [1, 0], { x: 4, y: 3 }, [0, 1], 10);
    expect(dist(p[0], { x: 1, y: 1 })).toBeLessThan(1e-6);
    expect(dist(p[p.length - 1], { x: 4, y: 3 })).toBeLessThan(1e-6);
  });
});
