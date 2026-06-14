// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { expandLSystem } from '@/assetgen/geometry/flora/lsystem';
import { createRng } from '@/core/rng';

describe('flora L-system expander', () => {
  it('rewrites deterministic rules and passes turtle commands through', () => {
    // Algae axiom A→AB, B→A; turtle commands +-[] are untouched (no rule).
    const out = expandLSystem('A[+B]', { A: 'AB', B: 'A' }, 2, createRng(1));
    expect(out).toBe('ABA[+AB]');
  });

  it('is deterministic for a fixed seed (stochastic rules)', () => {
    const rules = { F: [{ to: 'FF', prob: 0.5 }, { to: 'F[+F]', prob: 0.5 }] };
    const a = expandLSystem('F', rules, 4, createRng(42));
    const b = expandLSystem('F', rules, 4, createRng(42));
    expect(a).toBe(b);
  });

  it('different seeds diverge for stochastic rules', () => {
    const rules = { F: [{ to: 'FF', prob: 0.5 }, { to: 'F[+F]', prob: 0.5 }] };
    const a = expandLSystem('F', rules, 5, createRng(1));
    const b = expandLSystem('F', rules, 5, createRng(999));
    expect(a).not.toBe(b);
  });
});
