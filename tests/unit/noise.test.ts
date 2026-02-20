import { describe, it, expect } from 'vitest';
import { Random, noise, fractalNoise } from '@/core/noise';

describe('Random', () => {
  it('produces deterministic output from the same seed', () => {
    const a = new Random(42);
    const b = new Random(42);
    expect(a.next()).toBe(b.next());
    expect(a.next()).toBe(b.next());
    expect(a.next()).toBe(b.next());
  });

  it('produces different output from different seeds', () => {
    const a = new Random(1);
    const b = new Random(2);
    expect(a.next()).not.toBe(b.next());
  });

  it('int() returns values within the specified range', () => {
    const r = new Random(99);
    for (let i = 0; i < 100; i++) {
      const v = r.int(5, 10);
      expect(v).toBeGreaterThanOrEqual(5);
      expect(v).toBeLessThanOrEqual(10);
    }
  });
});

describe('noise', () => {
  it('is deterministic for the same inputs', () => {
    expect(noise(3, 7, 42)).toBe(noise(3, 7, 42));
  });

  it('returns values between 0 and 1', () => {
    for (let i = 0; i < 100; i++) {
      const v = noise(i, i * 3, 1234);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe('fractalNoise', () => {
  it('returns values between 0 and 1', () => {
    for (let i = 0; i < 50; i++) {
      const v = fractalNoise(i, i * 2, 555);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});
