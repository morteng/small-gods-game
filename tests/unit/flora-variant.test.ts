// tests/unit/flora-variant.test.ts — the per-instance flora variety helpers must be
// pure + deterministic so a world's trees keep their chosen silhouettes across reloads.
import { describe, it, expect } from 'vitest';
import { FLORA_VARIANTS, floraVariantBucket, floraVariantSeed } from '@/render/flora-variant';

describe('floraVariantBucket', () => {
  it('is stable: the same id always maps to the same bucket', () => {
    const ids = ['veg-1', 'veg-2', 'oak@12,34', 'x', ''];
    for (const id of ids) {
      const a = floraVariantBucket(id, FLORA_VARIANTS);
      const b = floraVariantBucket(id, FLORA_VARIANTS);
      expect(b).toBe(a);
    }
  });

  it('always lands in 0..V-1', () => {
    for (let i = 0; i < 500; i++) {
      const v = floraVariantBucket(`entity-${i}`, FLORA_VARIANTS);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(FLORA_VARIANTS);
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  it('spreads a population across all buckets (not a constant)', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) seen.add(floraVariantBucket(`e${i}`, FLORA_VARIANTS));
    expect(seen.size).toBe(FLORA_VARIANTS);
  });

  it('degrades safely for V ≤ 1', () => {
    expect(floraVariantBucket('anything', 1)).toBe(0);
    expect(floraVariantBucket('anything', 0)).toBe(0);
  });
});

describe('floraVariantSeed', () => {
  it('variant 0 is 0 for every species (the current-look sentinel)', () => {
    for (const k of ['english-oak', 'scots-pine', 'weeping-willow', 'blackthorn']) {
      expect(floraVariantSeed(k, 0)).toBe(0);
    }
  });

  it('higher variants are non-zero and distinct per species', () => {
    for (const k of ['english-oak', 'scots-pine', 'blackthorn']) {
      const seeds = [0, 1, 2].map((v) => floraVariantSeed(k, v));
      expect(seeds[1]).not.toBe(0);
      expect(seeds[2]).not.toBe(0);
      expect(new Set(seeds).size).toBe(3); // 0, v1, v2 all distinct
    }
  });

  it('is deterministic (same kind+variant → same seed)', () => {
    expect(floraVariantSeed('english-oak', 2)).toBe(floraVariantSeed('english-oak', 2));
    // different species differ at the same variant index
    expect(floraVariantSeed('english-oak', 1)).not.toBe(floraVariantSeed('scots-pine', 1));
  });
});
