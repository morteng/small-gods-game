// The lantern ambient-dial's pure math: the darkness→alpha envelope (day glint → night bloom)
// and the per-lamp flicker multiplier. Both are exported for exactly this — pinning them without
// a canvas/WebGPU context (LanternField.draw needs CanvasRenderingContext2D, out of scope here).
import { describe, it, expect } from 'vitest';
import { lanternAlpha, lanternFlicker } from '@/studio/lantern-field';

describe('lanternAlpha', () => {
  it('day floor at nightFactor 0 — a faint glint, not invisible', () => {
    const a = lanternAlpha(0);
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(0.15);
  });

  it('night ceiling at nightFactor 1 — a strong bloom', () => {
    const a = lanternAlpha(1);
    expect(a).toBeGreaterThan(0.7);
    expect(a).toBeLessThanOrEqual(1);
  });

  it('monotonically non-decreasing as darkness increases', () => {
    let prev = -Infinity;
    for (let n = 0; n <= 1; n += 0.05) {
      const a = lanternAlpha(n);
      expect(a).toBeGreaterThanOrEqual(prev);
      prev = a;
    }
  });

  it('clamps out-of-range input', () => {
    expect(lanternAlpha(-5)).toBe(lanternAlpha(0));
    expect(lanternAlpha(5)).toBe(lanternAlpha(1));
  });

  it('is a real ramp, not a step: mid-dusk sits strictly between the endpoints', () => {
    const day = lanternAlpha(0), mid = lanternAlpha(0.5), night = lanternAlpha(1);
    expect(mid).toBeGreaterThan(day);
    expect(mid).toBeLessThan(night);
  });
});

describe('lanternFlicker', () => {
  it('stays within a tight band around 1 (a flame, not a strobe)', () => {
    for (let ms = 0; ms < 20000; ms += 137) {
      const f = lanternFlicker(ms, 3.14);
      expect(f).toBeGreaterThanOrEqual(0.8);
      expect(f).toBeLessThanOrEqual(1.2);
    }
  });

  it('different seeds decorrelate lamps on the same building at the same instant', () => {
    const a = lanternFlicker(1234, 0);
    const b = lanternFlicker(1234, 50);
    expect(a).not.toBeCloseTo(b, 5);
  });

  it('varies over time for a fixed seed (it animates)', () => {
    const values = [0, 500, 1000, 1500, 2000].map((ms) => lanternFlicker(ms, 1));
    const allSame = values.every((v) => v === values[0]);
    expect(allSame).toBe(false);
  });
});
