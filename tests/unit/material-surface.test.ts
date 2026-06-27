import { describe, it, expect } from 'vitest';
import {
  sampleSurface, FINISH_IDS, type FinishId, type SurfaceSpec,
} from '@/assetgen/render/material-surface';
import { MATERIAL_RGB, type Mat, type Vec3, type RGB } from '@/assetgen/types';

const MATS: Mat[] = [
  'stone', 'timber', 'plaster', 'thatch', 'tile',
  'foliage', 'bark', 'earth', 'metal', 'door', 'brick', 'glass',
];

const UP: Vec3 = [0, 0, 1];
const inGamut = (c: RGB) => c.every((v) => v >= 0 && v <= 255 && Number.isInteger(v));

describe('material-surface — sampleSurface', () => {
  it('is deterministic: identical inputs → byte-identical output', () => {
    const spec: SurfaceSpec = { material: 'stone', finish: 'limewash' };
    const a = sampleSurface(spec, [3.2, 1.7, 2.4], UP);
    const b = sampleSurface(spec, [3.2, 1.7, 2.4], UP);
    expect(a).toEqual(b);
  });

  it('every material × finish stays in gamut with valid roughness/ao and a unit normal', () => {
    for (const material of MATS) {
      for (const finish of FINISH_IDS) {
        const spec: SurfaceSpec = { material, finish };
        // sweep a handful of world positions on a vertical wall facet and a roof facet
        for (const [pos, n] of [
          [[1.3, 0.4, 2.1], [1, 0, 0]],
          [[0.7, 2.9, 1.4], [0, 1, 0]],
          [[2.2, 1.1, 3.5], [0, 0, 1]],
        ] as [Vec3, Vec3][]) {
          const s = sampleSurface(spec, pos, n);
          expect(inGamut(s.albedo), `${material}/${finish} albedo ${s.albedo}`).toBe(true);
          expect(s.roughness).toBeGreaterThanOrEqual(0);
          expect(s.roughness).toBeLessThanOrEqual(1);
          expect(s.ao).toBeGreaterThanOrEqual(0);
          expect(s.ao).toBeLessThanOrEqual(1);
          const len = Math.hypot(...s.normal);
          expect(len).toBeCloseTo(1, 5);
          expect(s.normal.every(Number.isFinite)).toBe(true);
        }
      }
    }
  });

  it('produces spatial variation (not a flat fill) across a wall', () => {
    const spec: SurfaceSpec = { material: 'brick' };
    const n: Vec3 = [0, 1, 0];
    const samples = Array.from({ length: 24 }, (_, i) =>
      sampleSurface(spec, [i * 0.07, 0, i * 0.05], n).albedo[0]);
    const min = Math.min(...samples), max = Math.max(...samples);
    expect(max - min).toBeGreaterThan(8);   // mortar joints + clay variance ⇒ real spread
  });

  it('materials are visually distinct from one another', () => {
    const pos: Vec3 = [1.1, 0.6, 1.9];
    const n: Vec3 = [1, 0, 0];
    const mean = (m: Mat) => {
      const s = sampleSurface({ material: m }, pos, n).albedo;
      return (s[0] + s[1] + s[2]) / 3;
    };
    // stone (grey) vs timber (brown) vs thatch (straw) should not collapse to one tone
    const tones = new Set([Math.round(mean('stone')), Math.round(mean('timber')), Math.round(mean('thatch'))]);
    expect(tones.size).toBe(3);
  });

  it("'bare' finish leaves the material tone anchored near its base albedo", () => {
    // Average many samples; the mean should track MATERIAL_RGB (tone has ~0 mean).
    const material: Mat = 'plaster';
    const base = MATERIAL_RGB[material];
    const n: Vec3 = [0, 1, 0];
    let r = 0, g = 0, b = 0; const N = 400;
    for (let i = 0; i < N; i++) {
      const s = sampleSurface({ material, finish: 'bare' }, [i * 0.031, 0, (i % 19) * 0.043], n).albedo;
      r += s[0]; g += s[1]; b += s[2];
    }
    expect(r / N).toBeCloseTo(base[0], -1);   // within ~±5 of the base channel
    expect(g / N).toBeCloseTo(base[1], -1);
    expect(b / N).toBeCloseTo(base[2], -1);
  });

  it('limewash brightens stone; tar darkens timber (finishes actually paint)', () => {
    const pos: Vec3 = [0.9, 0.3, 1.6];
    const n: Vec3 = [0, 1, 0];
    const lum = (c: RGB) => c[0] + c[1] + c[2];
    const bareStone = sampleSurface({ material: 'stone', finish: 'bare' }, pos, n).albedo;
    const limeStone = sampleSurface({ material: 'stone', finish: 'limewash' }, pos, n).albedo;
    expect(lum(limeStone)).toBeGreaterThan(lum(bareStone));

    const bareTimber = sampleSurface({ material: 'timber', finish: 'bare' }, pos, n).albedo;
    const tarTimber = sampleSurface({ material: 'timber', finish: 'tar' }, pos, n).albedo;
    expect(lum(tarTimber)).toBeLessThan(lum(bareTimber));
    expect(tarTimber.length).toBe(3);
  });

  it('tar lowers roughness (sealed/glossy); limewash keeps it matte', () => {
    const pos: Vec3 = [1.4, 0.2, 2.0];
    const n: Vec3 = [0, 1, 0];
    const tar = sampleSurface({ material: 'timber', finish: 'tar' }, pos, n).roughness;
    const bare = sampleSurface({ material: 'timber', finish: 'bare' }, pos, n).roughness;
    expect(tar).toBeLessThan(bare);
    const lime = sampleSurface({ material: 'stone', finish: 'limewash' }, pos, n).roughness;
    expect(lime).toBeGreaterThan(0.8);
  });

  it('polychrome honours the decorative tint', () => {
    const pos: Vec3 = [0.5, 0.5, 1.0];
    const n: Vec3 = [0, 1, 0];
    const redTint: RGB = [200, 40, 40];
    const blueTint: RGB = [40, 40, 200];
    const red = sampleSurface({ material: 'plaster', finish: 'polychrome', tint: redTint }, pos, n).albedo;
    const blue = sampleSurface({ material: 'plaster', finish: 'polychrome', tint: blueTint }, pos, n).albedo;
    expect(red[0]).toBeGreaterThan(blue[0]);   // red-tinted reads redder
    expect(blue[2]).toBeGreaterThan(red[2]);   // blue-tinted reads bluer
  });

  it('the surface is continuous in world space (no discontinuity between adjacent pixels)', () => {
    const spec: SurfaceSpec = { material: 'stone' };
    const n: Vec3 = [0, 1, 0];
    let prev = sampleSurface(spec, [0, 0, 1], n).albedo;
    for (let i = 1; i < 200; i++) {
      const p: Vec3 = [i * 0.002, 0, 1];            // 2 mm steps
      const cur = sampleSurface(spec, p, n).albedo;
      const jump = Math.max(Math.abs(cur[0] - prev[0]), Math.abs(cur[1] - prev[1]), Math.abs(cur[2] - prev[2]));
      expect(jump).toBeLessThan(40);                // smooth, save at sharp joints — bounded
      prev = cur;
    }
  });

  it('unitsPerMetre rescales the pattern (coarser features at larger scale)', () => {
    // Two identical materials sampled with different calibration should differ in texture.
    const a = sampleSurface({ material: 'brick' }, [0.5, 0, 0.3], [0, 1, 0], 1);
    const b = sampleSurface({ material: 'brick' }, [0.5, 0, 0.3], [0, 1, 0], 4);
    expect(a.albedo).not.toEqual(b.albedo);
  });
});

describe('material-surface — purity guard', () => {
  it('the source contains no Math.random', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(
      path.resolve(process.cwd(), 'src/assetgen/render/material-surface.ts'), 'utf8');
    expect(src.includes('Math.random(')).toBe(false);   // the call form, as the sim guard scans
  });

  it('every declared finish id is wired', () => {
    const ids: FinishId[] = [...FINISH_IDS];
    expect(ids).toContain('bare');
    expect(ids).toContain('gilt');
    expect(new Set(ids).size).toBe(ids.length);   // no dupes
  });
});
