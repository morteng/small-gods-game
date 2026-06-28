// tests/unit/buildability-envelope.test.ts — the capability filter that gates WHICH structures
// a settlement may build. Pins: behaviour-preserving bridge thresholds (understanding=0 ==
// the old era×prosperity rule), the understanding axis unlocking grander works early, and the
// other capability accessors.
import { describe, it, expect } from 'vitest';
import {
  effectiveTech, bridgeClassFor, wallClassFor, pavingCeilingFor, archStylesFor, resolveEnvelope,
} from '@/world/connectome/buildability-envelope';

describe('effectiveTech', () => {
  it('is the era baseline lifted by understanding (clamped 0..1, up to +1 era)', () => {
    expect(effectiveTech({ era: 1, economy: 0 })).toBe(1);              // no understanding → era
    expect(effectiveTech({ era: 1, economy: 0, understanding: 1 })).toBe(2);   // full → +1 era
    expect(effectiveTech({ era: 1, economy: 0, understanding: 0.5 })).toBe(1.5);
    expect(effectiveTech({ era: 1, economy: 0, understanding: 5 })).toBe(2);   // clamp >1
  });
});

describe('bridgeClassFor (behaviour-preserving thresholds)', () => {
  it('reproduces the historic era×prosperity×importance gate when understanding=0', () => {
    // dressed stone needs era≥2, economy≥1, importance≥1
    expect(bridgeClassFor({ era: 2, economy: 1 }, 1)).toBe('dressed-stone');
    expect(bridgeClassFor({ era: 2, economy: 0 }, 1)).toBe('timber');     // poor → timber
    expect(bridgeClassFor({ era: 2, economy: 1 }, 0)).toBe('timber');     // footpath → timber
    // timber needs era≥1 OR economy≥1
    expect(bridgeClassFor({ era: 1, economy: 0 }, 0)).toBe('timber');
    expect(bridgeClassFor({ era: 0, economy: 1 }, 0)).toBe('timber');
    // else the bare log-plank footbridge
    expect(bridgeClassFor({ era: 0, economy: 0 }, 0)).toBe('log-plank');
  });

  it('aggregate understanding unlocks a stone bridge a settlement could not otherwise build', () => {
    // era 1 + poor economy normally tops out at timber…
    expect(bridgeClassFor({ era: 1, economy: 1 }, 2)).toBe('timber');
    // …but a deeply-understanding people (tech → 2) earn the dressed-stone arch.
    expect(bridgeClassFor({ era: 1, economy: 1, understanding: 1 }, 2)).toBe('dressed-stone');
  });
});

describe('other capability accessors', () => {
  it('wall class scales with tech AND economy', () => {
    expect(wallClassFor({ era: 0, economy: 0 })).toBe('none');
    expect(wallClassFor({ era: 1, economy: 1 })).toBe('timber-pale');
    expect(wallClassFor({ era: 3, economy: 3 })).toBe('stone-curtain');
  });

  it('paving ceiling rises with economy/tech', () => {
    expect(pavingCeilingFor({ era: 0, economy: 0 })).toBe('dirt');
    expect(pavingCeilingFor({ era: 1, economy: 1 })).toBe('gravel');
    expect(pavingCeilingFor({ era: 3, economy: 3 })).toBe('cobble');
  });

  it('arch styles gate the gothic vocabulary behind tech', () => {
    expect([...archStylesFor({ era: 0, economy: 0 })]).toEqual(['flat']);
    expect(archStylesFor({ era: 1, economy: 0 }).has('round')).toBe(true);
    expect(archStylesFor({ era: 1, economy: 0 }).has('pointed')).toBe(false);
    expect(archStylesFor({ era: 2, economy: 0 }).has('pointed')).toBe(true);
  });

  it('resolveEnvelope returns the whole capability set in one call', () => {
    const env = resolveEnvelope({ era: 3, economy: 3 }, 3);
    expect(env.bridge).toBe('dressed-stone');
    expect(env.wall).toBe('stone-curtain');
    expect(env.paving).toBe('cobble');
    expect(env.archStyles.has('pointed')).toBe(true);
  });
});
