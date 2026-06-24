import { describe, it, expect } from 'vitest';
import {
  dedupe,
  simplifyPath,
  catmullRomChain,
  smoothCenterline,
  type Pt,
} from '@/terrain/road-centerline';

/** A 4-connected staircase approximating the diagonal (0,0)→(n,n). */
function staircase(n: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    out.push({ x: i, y: i });
    out.push({ x: i + 1, y: i }); // step right then up — the grid zig-zag
  }
  out.push({ x: n, y: n });
  return out;
}

describe('dedupe', () => {
  it('drops consecutive duplicate coordinates', () => {
    const got = dedupe([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 0 }]);
    expect(got).toEqual([{ x: 0, y: 0 }, { x: 1, y: 0 }]);
  });
});

describe('simplifyPath (RDP)', () => {
  it('collapses a straight run to its two endpoints', () => {
    const line: Pt[] = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }];
    expect(simplifyPath(line, 0.1)).toEqual([{ x: 0, y: 0 }, { x: 3, y: 0 }]);
  });

  it('collapses a near-diagonal staircase to few corners', () => {
    const corners = simplifyPath(staircase(8), 0.75);
    // 17 staircase points → a handful of corners, never the original count.
    expect(corners.length).toBeLessThan(6);
    expect(corners[0]).toEqual({ x: 0, y: 0 });
    expect(corners[corners.length - 1]).toEqual({ x: 8, y: 8 });
  });

  it('keeps a genuine corner', () => {
    const L: Pt[] = [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }];
    expect(simplifyPath(L, 0.5)).toEqual(L);
  });
});

describe('catmullRomChain', () => {
  it('passes through its control points', () => {
    const cps: Pt[] = [{ x: 0, y: 0 }, { x: 4, y: 1 }, { x: 8, y: 0 }, { x: 12, y: 2 }];
    const curve = catmullRomChain(cps, 1);
    for (const cp of cps) {
      const hit = curve.some((p) => Math.hypot(p.x - cp.x, p.y - cp.y) < 1e-6);
      expect(hit).toBe(true);
    }
  });

  it('resamples to roughly arcStep spacing (no large gaps)', () => {
    const curve = catmullRomChain([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }], 1);
    let total = 0;
    for (let i = 1; i < curve.length; i++) {
      const step = Math.hypot(curve[i].x - curve[i - 1].x, curve[i].y - curve[i - 1].y);
      // Uniform-parameter sampling of a centripetal spline isn't strictly
      // arc-length even, but there must be no gap big enough to leave the carve
      // unsampled between vertices.
      expect(step).toBeLessThan(1.6);
      total += step;
    }
    const mean = total / (curve.length - 1);
    expect(mean).toBeGreaterThan(0.5);
    expect(mean).toBeLessThan(1.2);
  });

  it('returns ≤2 points unchanged', () => {
    expect(catmullRomChain([{ x: 1, y: 1 }, { x: 2, y: 2 }])).toEqual([{ x: 1, y: 1 }, { x: 2, y: 2 }]);
  });

  it('is deterministic', () => {
    const cps: Pt[] = [{ x: 0, y: 0 }, { x: 3, y: 4 }, { x: 7, y: 2 }, { x: 9, y: 6 }];
    expect(catmullRomChain(cps, 0.5)).toEqual(catmullRomChain(cps, 0.5));
  });
});

describe('smoothCenterline', () => {
  it('turns a staircase into a smooth line through the endpoints', () => {
    const out = smoothCenterline(staircase(8));
    expect(out[0]).toEqual({ x: 0, y: 0 });
    const last = out[out.length - 1];
    expect(Math.hypot(last.x - 8, last.y - 8)).toBeLessThan(1e-6);
    // Smoothed line hugs the true diagonal far better than the staircase: every
    // point sits within ~1 tile of the y=x line.
    for (const p of out) expect(Math.abs(p.x - p.y)).toBeLessThan(1.0);
  });

  it('does not blow up on degenerate / tiny inputs', () => {
    expect(smoothCenterline([])).toEqual([]);
    expect(smoothCenterline([{ x: 2, y: 2 }])).toEqual([{ x: 2, y: 2 }]);
  });
});
