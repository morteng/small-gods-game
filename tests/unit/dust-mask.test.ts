import { describe, it, expect } from 'vitest';
import { dust01 } from '@/render/dust-mask';

describe('dust-mask — CPU mirror of the terrain shader bare-ground splat weight', () => {
  it('is bounded [0,1] and deterministic per (moist, gx, gy)', () => {
    for (const [m, x, y] of [[0, 3, 7], [0.5, 100.5, 40.5], [1, 200.5, 90.5]] as const) {
      const v = dust01(m, x, y);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      expect(dust01(m, x, y)).toBe(v);
    }
  });

  it('is monotone in dryness: drier ground never paints LESS bare', () => {
    for (const [x, y] of [[10.5, 20.5], [55.5, 71.5], [130.5, 44.5]] as const) {
      let prev = dust01(1, x, y);          // wettest
      for (let m = 0.9; m >= -1e-9; m -= 0.1) {
        const v = dust01(m, x, y);
        expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
        prev = v;
      }
    }
  });

  it('wet ground is never bare; bone-dry patchy ground saturates', () => {
    // Fully wet: dry term 0 → 0.55·bareField + 0.1·jit tops out below the 0.58 threshold.
    for (let i = 0; i < 50; i++) expect(dust01(1, i * 3.7 + 0.5, i * 5.3 + 0.5)).toBe(0);
    // Fully dry: 0.65 + noise ≥ threshold across most of the field — some cells saturate.
    let hit = 0;
    for (let i = 0; i < 50; i++) if (dust01(0, i * 3.7 + 0.5, i * 5.3 + 0.5) > 0.9) hit++;
    expect(hit).toBeGreaterThan(0);
  });

  it('varies spatially at fixed moisture (the bare-patch field, not a uniform wash)', () => {
    const vals = new Set<number>();
    for (let i = 0; i < 40; i++) vals.add(Math.round(dust01(0.35, i * 7.1 + 0.5, i * 11.3 + 0.5) * 100));
    expect(vals.size).toBeGreaterThan(3);
  });
});
