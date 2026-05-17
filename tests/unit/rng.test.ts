import { describe, it, expect } from 'vitest';
import { createRng, fromState } from '@/core/rng';

describe('sfc32 rng', () => {
  it('produces a stable reference sequence for seed 1', () => {
    const rng = createRng(1);
    const out: number[] = [];
    for (let i = 0; i < 8; i++) out.push(Math.floor(rng.next() * 0x1_0000_0000));
    expect(out).toMatchInlineSnapshot(`
      [
        587941090,
        3698788925,
        2524488572,
        3535790054,
        330041027,
        2125978803,
        1112819093,
        1554127126,
      ]
    `);
  });

  it('next() returns values in [0, 1)', () => {
    const rng = createRng(42);
    for (let i = 0; i < 1000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('nextInt(max) returns integers in [0, max)', () => {
    const rng = createRng(42);
    for (let i = 0; i < 1000; i++) {
      const v = rng.nextInt(10);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(10);
    }
  });

  it('getState() then fromState() resumes the same sequence', () => {
    const a = createRng(7);
    for (let i = 0; i < 50; i++) a.next();
    const snap = a.getState();
    const b = fromState(snap);
    expect(b.next()).toBe(a.next());
    expect(b.next()).toBe(a.next());
    expect(b.next()).toBe(a.next());
  });

  it('pick<T> draws from array, never out-of-bounds', () => {
    const rng = createRng(123);
    const arr = ['a', 'b', 'c', 'd'];
    for (let i = 0; i < 200; i++) {
      expect(arr).toContain(rng.pick(arr));
    }
  });
});
