import { describe, it, expect } from 'vitest';
import { VIEW_RECIPES } from '@/assetgen/view-registry';
import type { AssetBrief } from '@/assetgen/asset-brief';

function buildingBrief(footprint: { w: number; h: number }, heightUnits: number): AssetBrief {
  return {
    kind: 'building',
    subject: 'x',
    traits: [],
    materials: [],
    view: 'iso-3q',
    era: 'medieval',
    footprint,
    heightUnits,
    paletteAnchors: [],
    negatives: [],
    seed: 0,
  };
}

describe('VIEW_RECIPES iso-3q', () => {
  it('uses the v2 recipe (baseless + view-relative door)', () => {
    expect(VIEW_RECIPES['iso-3q'].recipeVersion).toBe('v2');
    expect(VIEW_RECIPES['iso-3q'].lightDirection).toBe('top-left');
  });

  it('returns the TRUE footprint-diamond width (no 128 cap) so sprites blit 1:1', () => {
    // 2x2 → rawW = (2+2)*64 = 256 (exact, snap16 no-op);
    // rawH = (2+2)*32 + 1.7*64 = 236.8 -> snap16 -> 240.
    expect(VIEW_RECIPES['iso-3q'].nativeSize(buildingBrief({ w: 2, h: 2 }, 1.7)))
      .toEqual({ width: 256, height: 240 });
  });

  it('keeps a capped 3x3 building at its full 384px width, elongation preserved', () => {
    // 3x3 → rawW = (3+3)*64 = 384; rawH = (3+3)*32 + 1.5*64 = 288.
    expect(VIEW_RECIPES['iso-3q'].nativeSize(buildingBrief({ w: 3, h: 3 }, 1.5)))
      .toEqual({ width: 384, height: 288 });
  });

  it('caps an oversized footprint at the 400px PixelLab gen limit (safety net)', () => {
    // 5x2 → rawW = (5+2)*64 = 448 > 400 -> clamped+snap16 -> 400.
    expect(VIEW_RECIPES['iso-3q'].nativeSize(buildingBrief({ w: 5, h: 2 }, 1.5)).width)
      .toBe(400);
  });

  it('defaults footprint/heightUnits when absent', () => {
    const brief: AssetBrief = {
      kind: 'building', subject: 'x', traits: [], materials: [],
      view: 'iso-3q', era: 'medieval', paletteAnchors: [], negatives: [], seed: 0,
    };
    // rawW = (1+1)*64 = 128; rawH = (1+1)*32 + 1*64 = 128 -> 128x128
    expect(VIEW_RECIPES['iso-3q'].nativeSize(brief)).toEqual({ width: 128, height: 128 });
  });
});
