// The baked tiling-noise atlas that replaced the water shaders' per-fragment ALU fbm.
// Guards the three properties the shaders rely on:
//   1. deterministic bake (no Math.random — reproducible frames),
//   2. channels actually span toward [0,1] (the old in-shader fbm topped out at 0.75,
//      which dead-zoned every smoothstep(0.82,…) glint threshold),
//   3. seamless wrap — sampled with `repeat` addressing, the seam step must look like
//      any interior step, or the ocean would show a 64-tile grid of lines.
import { describe, it, expect } from 'vitest';
import { bakeNoiseAtlas, NOISE_TEX_SIZE, NOISE_TILE_UNITS } from '@/render/gpu/noise-texture';

const SIZE = 128; // small bake keeps the test fast; same lattice, coarser sampling

describe('noise atlas', () => {
  it('bakes deterministically', () => {
    const a = bakeNoiseAtlas(SIZE);
    const b = bakeNoiseAtlas(SIZE);
    expect(a.length).toBe(SIZE * SIZE * 4);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it('every channel is normalised — spread reaches the glint-threshold band', () => {
    const px = bakeNoiseAtlas(SIZE);
    for (let ch = 0; ch < 4; ch++) {
      let min = 255, max = 0, sum = 0;
      for (let i = ch; i < px.length; i += 4) {
        const v = px[i];
        if (v < min) min = v;
        if (v > max) max = v;
        sum += v;
      }
      const mean = sum / (SIZE * SIZE);
      expect(min, `ch${ch} min`).toBeLessThan(80);
      // 0.88 * 255 ≈ 224 — the sun-glitter threshold must be reachable on the
      // channel that feeds it (A). More octaves concentrate toward the mean, so the
      // 3-octave B channel only needs a healthy general spread.
      expect(max, `ch${ch} max`).toBeGreaterThan(ch === 3 ? 224 : 200);
      expect(mean, `ch${ch} mean`).toBeGreaterThan(100);
      expect(mean, `ch${ch} mean`).toBeLessThan(155);
    }
  });

  it('wraps seamlessly: the seam step is no rougher than interior steps', () => {
    const px = bakeNoiseAtlas(SIZE);
    const at = (x: number, y: number, ch: number) => px[(y * SIZE + x) * 4 + ch];
    for (let ch = 0; ch < 4; ch++) {
      let maxInterior = 0, maxSeam = 0;
      for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE - 1; x++) {
          maxInterior = Math.max(maxInterior, Math.abs(at(x + 1, y, ch) - at(x, y, ch)));
        }
        maxSeam = Math.max(maxSeam, Math.abs(at(0, y, ch) - at(SIZE - 1, y, ch)));
      }
      // Wrap continuity: the seam behaves like one more interior step (small slack
      // because the true max interior step is a sample, not a bound).
      expect(maxSeam, `ch${ch} seam`).toBeLessThanOrEqual(maxInterior + 8);
    }
  });

  it('default size and tile period stay in step with the shader constant', () => {
    // NOISE_INV_TILE in water-wgsl.ts / ocean-backdrop-wgsl.ts is hardcoded 1/64.
    expect(NOISE_TILE_UNITS).toBe(64);
    expect(NOISE_TEX_SIZE % NOISE_TILE_UNITS).toBe(0);
  });
});
