// @vitest-environment node
// Alpine fidelity: only genuinely DECIDUOUS species drop their crown in the snow mask.
// Evergreens (and rocks, and the hand presets that aren't flora-DB species) keep their
// seeded silhouette bucket and rely on the per-instance whiten instead.
import { describe, it, expect } from 'vitest';
import {
  floraLeafPhenology, isDeciduousFloraKind, floraVariantForSnow, SNOW_BARE_THRESHOLD,
} from '@/render/flora-phenology';
import { FLORA_BARE_VARIANT, FLORA_VARIANTS, floraVariantBucket } from '@/render/flora-variant';

const DECIDUOUS = ['english-oak', 'silver-birch', 'european-beech'];
const EVERGREEN = ['scots-pine', 'norway-spruce', 'european-yew'];

const ID = 'veg-42';
const DEEP_SNOW = 0.9;
const NO_SNOW = 0.05;

describe('floraLeafPhenology', () => {
  it('reads the flora DB', () => {
    expect(floraLeafPhenology('english-oak')).toBe('deciduous');
    expect(floraLeafPhenology('scots-pine')).toBe('evergreen');
  });

  it('is null for non-species kinds (hand presets, rocks are not leafy)', () => {
    expect(floraLeafPhenology('no-such-species')).toBeNull();
    expect(isDeciduousFloraKind('granite-boulder')).toBe(false);   // phenology 'none'
    expect(isDeciduousFloraKind('boulder')).toBe(false);           // hand rock preset
  });

  it('semi-evergreens are NOT deciduous (they keep the crown)', () => {
    expect(floraLeafPhenology('bramble')).toBe('semi_evergreen');
    expect(isDeciduousFloraKind('bramble')).toBe(false);
  });
});

describe('floraVariantForSnow — the bare-crown swap', () => {
  it('a DECIDUOUS kind on a snowy tile picks the bare slot', () => {
    for (const kind of DECIDUOUS) {
      expect(floraVariantForSnow(kind, ID, DEEP_SNOW), kind).toBe(FLORA_BARE_VARIANT);
    }
  });

  it('an EVERGREEN kind on the SAME tile does not — it keeps its seeded bucket', () => {
    for (const kind of EVERGREEN) {
      const v = floraVariantForSnow(kind, ID, DEEP_SNOW);
      expect(v, kind).toBe(floraVariantBucket(ID, FLORA_VARIANTS));
      expect(v, kind).toBeLessThan(FLORA_BARE_VARIANT);
    }
  });

  it('a DECIDUOUS kind OFF the snow keeps its seeded bucket', () => {
    for (const kind of DECIDUOUS) {
      const v = floraVariantForSnow(kind, ID, NO_SNOW);
      expect(v, kind).toBe(floraVariantBucket(ID, FLORA_VARIANTS));
      expect(v, kind).toBeLessThan(FLORA_BARE_VARIANT);
    }
  });

  it('the threshold is the switch (at it → bare, a hair under → leafy)', () => {
    expect(floraVariantForSnow('english-oak', ID, SNOW_BARE_THRESHOLD)).toBe(FLORA_BARE_VARIANT);
    expect(floraVariantForSnow('english-oak', ID, SNOW_BARE_THRESHOLD - 1e-6)).toBeLessThan(FLORA_BARE_VARIANT);
  });

  it('the seeded bucket can never land on the bare slot (it sits one past the buckets)', () => {
    expect(FLORA_BARE_VARIANT).toBe(FLORA_VARIANTS);
    for (let i = 0; i < 500; i++) {
      expect(floraVariantBucket(`e${i}`, FLORA_VARIANTS)).toBeLessThan(FLORA_BARE_VARIANT);
    }
  });

  it('is deterministic (same kind + id + snow → same variant)', () => {
    const a = floraVariantForSnow('english-oak', 'veg-7', NO_SNOW);
    expect(floraVariantForSnow('english-oak', 'veg-7', NO_SNOW)).toBe(a);
  });
});
