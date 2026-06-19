import { describe, it, expect } from 'vitest';
import {
  smoothCenterline,
  simplifyRDP,
  centerlineSamples,
  buildRibbonMesh,
  RIBBON_FLOATS_PER_VERTEX,
  type Pt,
} from '@/render/ribbon/ribbon-geometry';

const straight: Pt[] = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 2, y: 0 },
  { x: 3, y: 0 },
];

describe('smoothCenterline', () => {
  it('passes through the endpoints', () => {
    const c = smoothCenterline(straight);
    expect(c[0]).toEqual({ x: 0, y: 0 });
    const last = c[c.length - 1];
    expect(last.x).toBeCloseTo(3, 6);
    expect(last.y).toBeCloseTo(0, 6);
  });

  it('keeps a straight line straight (y stays 0)', () => {
    const c = smoothCenterline(straight);
    for (const p of c) expect(p.y).toBeCloseTo(0, 6);
    // Monotone increasing x.
    for (let i = 1; i < c.length; i++) expect(c[i].x).toBeGreaterThanOrEqual(c[i - 1].x - 1e-9);
  });

  it('passes a <3-point polyline through unchanged', () => {
    const c = smoothCenterline([{ x: 0, y: 0 }, { x: 5, y: 5 }]);
    expect(c).toEqual([{ x: 0, y: 0 }, { x: 5, y: 5 }]);
  });

  it('resamples finer with a smaller step', () => {
    const coarse = smoothCenterline(straight, 1.0);
    const fine = smoothCenterline(straight, 0.25);
    expect(fine.length).toBeGreaterThan(coarse.length);
  });
});

describe('simplifyRDP', () => {
  it('collapses a 4-connected diagonal staircase to its endpoints', () => {
    // E,N,E,N,... staircase along the y=x diagonal.
    const stair: Pt[] = [];
    for (let i = 0; i < 6; i++) { stair.push({ x: i, y: i }, { x: i + 1, y: i }); }
    stair.push({ x: 6, y: 6 });
    const simp = simplifyRDP(stair, 1.4);
    // The whole staircase hugs the diagonal (≤0.71 off) → just the two ends remain.
    expect(simp.length).toBeLessThanOrEqual(3);
    expect(simp[0]).toEqual(stair[0]);
    expect(simp[simp.length - 1]).toEqual(stair[stair.length - 1]);
  });

  it('preserves a genuine right-angle corner', () => {
    // East 10 then north 10 — the corner deviates ~7 tiles from the chord.
    const L: Pt[] = [];
    for (let x = 0; x <= 10; x++) L.push({ x, y: 0 });
    for (let y = 1; y <= 10; y++) L.push({ x: 10, y });
    const simp = simplifyRDP(L, 1.4);
    expect(simp.some((p) => p.x === 10 && p.y === 0)).toBe(true); // corner kept
    expect(simp.length).toBeLessThan(L.length);                   // straights collapsed
  });

  it('passes <3-point / zero-tol input through unchanged', () => {
    expect(simplifyRDP([{ x: 0, y: 0 }, { x: 1, y: 1 }], 1)).toHaveLength(2);
    const pts: Pt[] = [{ x: 0, y: 0 }, { x: 1, y: 5 }, { x: 2, y: 0 }];
    expect(simplifyRDP(pts, 0)).toHaveLength(3);
  });
});

describe('centerlineSamples', () => {
  it('unit tangent points downstream along a straight ribbon', () => {
    const s = centerlineSamples({ points: straight, halfWidth: 0.5 });
    for (const v of s) {
      expect(Math.hypot(v.tx, v.ty)).toBeCloseTo(1, 6);
      expect(v.tx).toBeCloseTo(1, 6); // +x
      expect(v.ty).toBeCloseTo(0, 6);
    }
  });

  it('arc length is monotone and ends near the polyline length', () => {
    const s = centerlineSamples({ points: straight, halfWidth: 0.5 });
    for (let i = 1; i < s.length; i++) expect(s[i].along).toBeGreaterThanOrEqual(s[i - 1].along);
    expect(s[s.length - 1].along).toBeCloseTo(3, 1);
  });

  it('evaluates per-sample scalar callbacks with normalised arc length', () => {
    const along01: number[] = [];
    const s = centerlineSamples({
      points: straight,
      halfWidth: (_x, _y, a) => {
        along01.push(a);
        return 0.5 + a; // widen downstream
      },
      speed: (_x, _y, a) => a * 2,
    });
    expect(along01[0]).toBeCloseTo(0, 6);
    expect(along01[along01.length - 1]).toBeCloseTo(1, 6);
    // Width grows along the ribbon; speed too.
    expect(s[s.length - 1].halfWidth).toBeGreaterThan(s[0].halfWidth);
    expect(s[s.length - 1].speed).toBeGreaterThan(s[0].speed);
  });
});

describe('buildRibbonMesh', () => {
  it('emits 6 verts per centerline segment with the right stride', () => {
    const s = centerlineSamples({ points: straight, halfWidth: 0.5 });
    const mesh = buildRibbonMesh([{ points: straight, halfWidth: 0.5 }]);
    expect(mesh.vertexCount).toBe((s.length - 1) * 6);
    expect(mesh.data.length).toBe(mesh.vertexCount * RIBBON_FLOATS_PER_VERTEX);
  });

  it('offsets banks by ±halfWidth perpendicular to the tangent', () => {
    // Straight east-bound ribbon → banks are at y = ∓halfWidth (across −1 → +y? check sign).
    const hw = 0.5;
    const mesh = buildRibbonMesh([{ points: straight, halfWidth: hw }]);
    const fpv = RIBBON_FLOATS_PER_VERTEX;
    // Collect distinct |y| offsets across all vertices.
    const ys = new Set<number>();
    for (let v = 0; v < mesh.vertexCount; v++) ys.add(Number(mesh.data[v * fpv + 1].toFixed(4)));
    // For tangent +x, perpendicular (−ty,tx)=(0,1); across=±1 → y = ±hw.
    expect([...ys].some((y) => Math.abs(y - hw) < 1e-3)).toBe(true);
    expect([...ys].some((y) => Math.abs(y + hw) < 1e-3)).toBe(true);
  });

  it('across attribute is −1 / +1 on the two banks', () => {
    const mesh = buildRibbonMesh([{ points: straight, halfWidth: 0.5 }]);
    const fpv = RIBBON_FLOATS_PER_VERTEX;
    const across = new Set<number>();
    for (let v = 0; v < mesh.vertexCount; v++) across.add(mesh.data[v * fpv + 2]);
    expect(across.has(-1)).toBe(true);
    expect(across.has(1)).toBe(true);
  });

  it('empty / degenerate input yields an empty mesh', () => {
    expect(buildRibbonMesh([]).vertexCount).toBe(0);
    expect(buildRibbonMesh([{ points: [{ x: 0, y: 0 }], halfWidth: 1 }]).vertexCount).toBe(0);
  });
});
