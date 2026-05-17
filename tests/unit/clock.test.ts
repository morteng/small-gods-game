import { describe, it, expect } from 'vitest';
import { SimClock } from '@/core/clock';

describe('SimClock', () => {
  it('starts at tick 0', () => {
    const c = new SimClock();
    expect(c.now()).toBe(0);
  });

  it('advances whole ticks at the default 16.667 ms/tick rate', () => {
    const c = new SimClock();
    c.advance(16.667);
    expect(c.now()).toBe(1);
    c.advance(33.334);
    expect(c.now()).toBe(3);
  });

  it('accumulates sub-tick ms without advancing', () => {
    const c = new SimClock();
    c.advance(10);
    expect(c.now()).toBe(0);
    c.advance(7);
    expect(c.now()).toBe(1);
  });

  it('respects custom msPerTick', () => {
    const c = new SimClock(100);
    c.advance(250);
    expect(c.now()).toBe(2);
    c.advance(50);
    expect(c.now()).toBe(3);
  });

  it('is monotonic — never goes backwards', () => {
    const c = new SimClock();
    for (let i = 0; i < 100; i++) {
      const before = c.now();
      c.advance(Math.random() * 50);
      expect(c.now()).toBeGreaterThanOrEqual(before);
    }
  });
});
