import { describe, it, expect } from 'vitest';
import { routeAqueduct } from '@/world/connectome/aqueduct-route';
import { planAqueductProfile } from '@/world/connectome/aqueduct-profile';

const P = (x: number, y: number) => ({ x, y });
const isUnitStepped = (path: Array<{ x: number; y: number }>) =>
  path.every((p, i) => i === 0 || Math.abs(p.x - path[i - 1].x) + Math.abs(p.y - path[i - 1].y) === 1);

describe('routeAqueduct — grade-constrained aqueduct router', () => {
  // A plane descending 1 m/tile toward +x; reliefM 1 so elevAt is metres. maxGrade 0.6 lets the
  // channel hug this slope as a surface channel (fall up to 1.2 m/tile ≥ the 1 m/tile descent).
  const plane = (x: number) => 20 - x;
  const base = { elevAt: (x: number) => plane(x), reliefM: 1, width: 16, height: 12, maxGrade: 0.6 };

  it('routes across open descending ground and delivers a feasible surface channel', () => {
    const r = routeAqueduct(P(0, 5), P(8, 5), base)!;
    expect(r).not.toBeNull();
    expect(r.path[0]).toEqual({ x: 0, y: 5 });
    expect(r.path[r.path.length - 1]).toEqual({ x: 8, y: 5 });
    expect(isUnitStepped(r.path)).toBe(true);
    expect(r.profile.feasible).toBe(true);
    expect(r.profile.stations.every((s) => s.mode === 'surface')).toBe(true);
  });

  it('DETOURS around a rise rather than trenching a deep cut through it', () => {
    // A 3×3 hill (+15 m) straddling the straight line at (4,5). Going through it would need a ~14 m
    // cut; routing around keeps the channel cheap. Compare to the straight line's profile.
    const hill = (x: number, y: number) =>
      plane(x) + (Math.abs(x - 4) <= 1 && Math.abs(y - 5) <= 1 ? 15 : 0);
    const opts = { ...base, elevAt: hill };
    const r = routeAqueduct(P(0, 5), P(8, 5), opts)!;
    expect(r).not.toBeNull();
    // The straight line would carve a deep cut; the chosen line avoids the hill core entirely.
    const straight = Array.from({ length: 9 }, (_, x) => P(x, 5));
    const straightProf = planAqueductProfile(straight, { elevAt: hill, reliefM: 1, maxGrade: 0.6 })!;
    expect(straightProf.maxCutM).toBeGreaterThan(13);
    expect(r.path.some((p) => p.x === 4 && p.y === 5)).toBe(false);   // skirted the hill
    expect(r.profile.maxCutM).toBeLessThan(straightProf.maxCutM);
    expect(r.profile.feasible).toBe(true);
  });

  it('routes around a hard-blocked barrier through its gap', () => {
    // A wall at x=8 spanning y=3..9, with the map edges (y<3) open as the only way past.
    const blocked = (x: number, y: number) => x === 8 && y >= 3 && y <= 9;
    const r = routeAqueduct(P(0, 5), P(12, 5), { ...base, blocked })!;
    expect(r).not.toBeNull();
    expect(r.path.some((p) => blocked(p.x, p.y))).toBe(false);   // never crosses the wall
    expect(r.path[r.path.length - 1]).toEqual({ x: 12, y: 5 });
  });

  it('returns null when the sink is walled off completely', () => {
    const blocked = (x: number) => x === 8;   // full-height wall, no gap
    const r = routeAqueduct(P(0, 5), P(12, 5), { ...base, blocked });
    expect(r).toBeNull();
  });

  it('returns null for out-of-bounds endpoints', () => {
    expect(routeAqueduct(P(-1, 5), P(8, 5), base)).toBeNull();
    expect(routeAqueduct(P(0, 5), P(99, 5), base)).toBeNull();
  });

  it('finds a route but reports it INFEASIBLE when the source sits below the sink', () => {
    const rising = { ...base, elevAt: (x: number) => 10 + x };   // ground climbs toward the sink
    const r = routeAqueduct(P(0, 5), P(8, 5), rising)!;
    expect(r).not.toBeNull();                       // a path exists over open ground
    expect(r.profile.feasible).toBe(false);         // but water can't flow uphill
    expect(r.profile.reason).toMatch(/source not above sink/);
  });

  it('is deterministic — same inputs ⇒ identical path', () => {
    const a = routeAqueduct(P(0, 5), P(8, 5), base)!;
    const b = routeAqueduct(P(0, 5), P(8, 5), base)!;
    expect(JSON.stringify(a.path)).toEqual(JSON.stringify(b.path));
  });
});
