// tests/unit/blueprint-validity.test.ts
// Tier-1 intrinsic building-validity rules: thatch⇒pitched roof, levels capped by
// era tech × type. See docs/superpowers/specs/2026-06-16-building-validity-and-situation-design.md.
import { describe, it, expect, vi } from 'vitest';
import { coerceRoof, capLevels, applyPartValidity } from '@/blueprint/validity';

describe('coerceRoof — no flat thatch (organic roofs must shed water)', () => {
  it('thatch + flat → gable (coerced)', () => {
    expect(coerceRoof('flat', 'thatch')).toBe('gable');
  });
  it('thatch + stepped (a flat runtime kind) → gable', () => {
    expect(coerceRoof('stepped', 'thatch')).toBe('gable');
  });
  it('hide maps to a thatch covering → also coerced off flat', () => {
    expect(coerceRoof('flat', 'hide')).toBe('gable');
  });
  it('thatch + an already-pitched roof is left alone', () => {
    expect(coerceRoof('gable', 'thatch')).toBe('gable');
    expect(coerceRoof('shed', 'thatch')).toBe('shed');
  });
  it('a flat roof in a hard covering (tile/slate) is fine — only organic needs pitch', () => {
    expect(coerceRoof('flat', 'tile')).toBe('flat');
    expect(coerceRoof('flat', 'slate')).toBe('flat');
  });
  it('unknown / missing material is a no-op', () => {
    expect(coerceRoof('flat', undefined)).toBe('flat');
  });
});

describe('capLevels — height bounded by era tech AND type', () => {
  it('no 6-storey early-medieval cottage: caps bite (cottage type=2 ≤ medieval era=3)', () => {
    expect(capLevels(6, 'cottage', 'medieval')).toBe(2);   // min(medieval=3, cottage=2, 6)
  });
  it('the era cap is the firm tech limit', () => {
    expect(capLevels(8, 'townhouse', 'primordial')).toBe(1);  // primordial tech = 1 storey
    expect(capLevels(8, 'townhouse', 'ancient')).toBe(2);
    expect(capLevels(8, 'townhouse', 'classical')).toBe(3);
    expect(capLevels(8, 'townhouse', 'current')).toBe(4);     // current=6 but townhouse type=4
  });
  it('the type cap stops a cottage from becoming a tower regardless of era', () => {
    expect(capLevels(8, 'cottage', 'current')).toBe(2);       // cottage type cap = 2
    expect(capLevels(8, 'tower', 'current')).toBe(6);         // tower type=12 but current era=6
  });
  it('authored presets within their caps are unchanged (no retro-clamp)', () => {
    expect(capLevels(3, 'tower', undefined)).toBe(3);
    expect(capLevels(3, 'castle_keep', undefined)).toBe(3);
    expect(capLevels(2, 'tavern', undefined)).toBe(2);
    expect(capLevels(1, 'cottage', undefined)).toBe(1);
  });
  it('never returns below 1', () => {
    expect(capLevels(0, 'cottage', 'medieval')).toBe(1);
  });
  it('unknown type falls back to the default cap', () => {
    expect(capLevels(8, 'mystery_hall', undefined)).toBe(4);
  });
});

describe('applyPartValidity — combined, byte-stable when valid', () => {
  it('returns the SAME object reference when nothing fires (stable art-cache key)', () => {
    const params = { roof: 'gable', levels: 2 };
    expect(applyPartValidity(params, { roofMat: 'thatch', type: 'tavern', era: 'medieval' })).toBe(params);
  });
  it('coerces both roof and levels in one pass', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const out = applyPartValidity({ roof: 'flat', levels: 6 }, { roofMat: 'thatch', type: 'cottage', era: 'medieval' });
    expect(out.roof).toBe('gable');
    expect(out.levels).toBe(2);                              // min(medieval=3, cottage=2, 6)
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
  it('leaves a part with no roof/levels params untouched', () => {
    const params = { plan: 'rect' };
    expect(applyPartValidity(params, { type: 'well' })).toBe(params);
  });
});
