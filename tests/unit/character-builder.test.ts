import { describe, it, expect } from 'vitest';
import { buildCharacterSpec, specFromItems } from '@/render/lpc/character-builder';

describe('buildCharacterSpec', () => {
  it('returns a valid spec for farmer', () => {
    const spec = buildCharacterSpec('farmer', 0);
    // farmer is mixed-sex now — the seed decides man or woman
    expect(['male', 'female']).toContain(spec.sex);
    expect(spec.items['body']).toBeDefined();
    expect(spec.items['head']).toBeDefined();
  });

  it('uses child sex and bodyType for child role', () => {
    const spec = buildCharacterSpec('child', 0);
    expect(spec.sex).toBe('child');
    expect(spec.bodyType).toBe('child');
  });

  it('different seeds vary the look (hair style varies; colour is variantless upstream)', () => {
    // Hair colour is a single variantless sheet upstream, so variety comes from
    // STYLE, not colour. Across a seed sweep the farmer pool yields >1 style.
    const styles = new Set(
      [1, 2, 3, 17, 999, 12345].map((s) => buildCharacterSpec('farmer', s).items['hair']!.itemId),
    );
    expect(styles.size).toBeGreaterThan(1);
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
