import { describe, it, expect } from 'vitest';
import { clamp01, clamp, lerp, smoothstep, smoothstep01 } from '@/core/math';

describe('core/math — consolidated scalar helpers', () => {
  it('clamp01 pins to [0,1] and matches the Math.max/min form (incl. NaN passthrough)', () => {
    expect(clamp01(-0.5)).toBe(0);
    expect(clamp01(0.5)).toBe(0.5);
    expect(clamp01(1.5)).toBe(1);
    expect(clamp01(Number.NaN)).toBe(Math.max(0, Math.min(1, Number.NaN))); // NaN
  });

  it('clamp pins to [lo,hi]', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
  });

  it('lerp is the unclamped a+(b-a)*t', () => {
    expect(lerp(0, 10, 0.25)).toBe(2.5);
    expect(lerp(0, 10, 0)).toBe(0);
    expect(lerp(0, 10, 1)).toBe(10);
    expect(lerp(0, 10, 2)).toBe(20); // unclamped
  });

  it('smoothstep eases 0→1 across the band and clamps outside', () => {
    expect(smoothstep(0, 1, -1)).toBe(0);
    expect(smoothstep(0, 1, 2)).toBe(1);
    expect(smoothstep(0, 1, 0.5)).toBeCloseTo(0.5, 6);
    expect(smoothstep(0, 1, 0.25)).toBeCloseTo(0.15625, 6);
  });

  it('smoothstep01 eases an already-normalised t', () => {
    expect(smoothstep01(0)).toBe(0);
    expect(smoothstep01(1)).toBe(1);
    expect(smoothstep01(0.5)).toBeCloseTo(0.5, 6);
    expect(smoothstep01(1.5)).toBe(1); // clamps
  });
});
