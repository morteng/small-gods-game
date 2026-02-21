import { describe, it, expect } from 'vitest';
import { buildCharacterSpec, specFromItems } from '@/render/lpc/character-builder';

describe('buildCharacterSpec', () => {
  it('returns a valid spec for farmer', () => {
    const spec = buildCharacterSpec('farmer', 0);
    expect(spec.sex).toBe('male');
    expect(spec.bodyType).toBe('male');
    expect(spec.items['body']).toBeDefined();
    expect(spec.items['head']).toBeDefined();
  });

  it('uses child sex and bodyType for child role', () => {
    const spec = buildCharacterSpec('child', 0);
    expect(spec.sex).toBe('child');
    expect(spec.bodyType).toBe('child');
  });

  it('different seeds produce different hair variants for same role', () => {
    const s1 = buildCharacterSpec('farmer', 1);
    const s2 = buildCharacterSpec('farmer', 999);
    expect(s1.items['hair']).toBeDefined();
    expect(s2.items['hair']).toBeDefined();
    // Seeds should produce distinct hair colours
    expect(s1.items['hair']!.variant).not.toBe(s2.items['hair']!.variant);
  });

  it('all 8 roles return a spec without throwing', () => {
    const roles = ['farmer', 'priest', 'soldier', 'merchant', 'elder', 'child', 'noble', 'beggar'] as const;
    for (const role of roles) {
      expect(() => buildCharacterSpec(role, 42)).not.toThrow();
    }
  });
});

describe('specFromItems', () => {
  it('wraps items in a male spec', () => {
    const items = { body: { itemId: 'body', variant: 'light' } };
    const spec = specFromItems(items);
    expect(spec.sex).toBe('male');
    expect(spec.items).toEqual(items);
  });
});
