import { describe, it, expect } from 'vitest';
import { erodeElevation } from '@/terrain/erosion';

describe('erodeElevation', () => {
  it('does not mutate the input array', () => {
    const source = new Float32Array(64 * 64);
    for (let i = 0; i < source.length; i++) source[i] = Math.random();
    const snapshot = new Float32Array(source);
    const result = erodeElevation(source, 64, 64, { numParticles: 100 });
    for (let i = 0; i < source.length; i++) {
      expect(source[i]).toBe(snapshot[i]);
    }
    expect(result).not.toBe(source);
    expect(result.length).toBe(source.length);
  });

  it('preserves overall elevation range roughly (no runaway values)', () => {
    const w = 64, h = 64;
    const source = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        source[y * w + x] = 0.5 + 0.3 * Math.sin(x * 0.2) * Math.cos(y * 0.2);
      }
    }
    const minBefore = Math.min(...source);
    const maxBefore = Math.max(...source);

    const result = erodeElevation(source, w, h, { numParticles: 500 });

    const minAfter = Math.min(...result);
    const maxAfter = Math.max(...result);

    expect(minAfter).toBeGreaterThanOrEqual(0);
    expect(maxAfter).toBeLessThanOrEqual(1);
    expect(Math.abs(minAfter - minBefore)).toBeLessThan(0.2);
    expect(Math.abs(maxAfter - maxBefore)).toBeLessThan(0.2);
  });

  it('is deterministic given a seed', () => {
    const source = new Float32Array(32 * 32);
    for (let i = 0; i < source.length; i++) source[i] = (i % 17) / 17;

    const a = erodeElevation(source, 32, 32, { numParticles: 100, seed: 42 });
    const b = erodeElevation(source, 32, 32, { numParticles: 100, seed: 42 });

    for (let i = 0; i < a.length; i++) {
      expect(a[i]).toBe(b[i]);
    }
  });

  it('smooths sharp peaks (post-erosion max ≤ pre-erosion max)', () => {
    const w = 32, h = 32;
    const source = new Float32Array(w * h).fill(0.3);
    source[16 * w + 16] = 0.95;
    source[15 * w + 16] = 0.7;
    source[17 * w + 16] = 0.7;
    source[16 * w + 15] = 0.7;
    source[16 * w + 17] = 0.7;

    const result = erodeElevation(source, w, h, {
      numParticles: 2000,
      seed: 1,
    });

    expect(result[16 * w + 16]).toBeLessThanOrEqual(0.95);
  });

  it('actually changes some cells (proves erosion is happening, not a pass-through)', () => {
    const w = 32, h = 32;
    const source = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        source[y * w + x] = 0.5 + 0.3 * Math.sin(x * 0.5) * Math.cos(y * 0.5);
      }
    }
    const result = erodeElevation(source, w, h, { numParticles: 500, seed: 1 });
    let differences = 0;
    for (let i = 0; i < source.length; i++) {
      if (Math.abs(result[i] - source[i]) > 1e-6) differences++;
    }
    expect(differences).toBeGreaterThan(50);
  });
});
