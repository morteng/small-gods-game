import { describe, it, expect } from 'vitest';
import { createState } from '@/core/state';

describe('GameState.rng', () => {
  it('is present on a fresh state', () => {
    const s = createState();
    expect(s.rng).toBeDefined();
    expect(typeof s.rng.next).toBe('function');
  });

  it('two fresh states produce the same sequence (deterministic default seed)', () => {
    const a = createState();
    const b = createState();
    const seqA = Array.from({ length: 8 }, () => a.rng.next());
    const seqB = Array.from({ length: 8 }, () => b.rng.next());
    expect(seqA).toEqual(seqB);
  });
});
