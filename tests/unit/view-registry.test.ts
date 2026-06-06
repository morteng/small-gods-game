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
  it('uses the frozen v1 recipe', () => {
    expect(VIEW_RECIPES['iso-3q'].recipeVersion).toBe('v1');
    expect(VIEW_RECIPES['iso-3q'].lightDirection).toBe('top-left');
  });

  it('nativeSize for a 2x2 single-storey gable building (256 x 240)', () => {
    // width  = (2+2)*64 = 256
    // height = (2+2)*32 + 1.7*64 = 128 + 108.8 = 236.8 -> snap16 -> 240
    expect(VIEW_RECIPES['iso-3q'].nativeSize(buildingBrief({ w: 2, h: 2 }, 1.7)))
      .toEqual({ width: 256, height: 240 });
  });

  it('clamps a 5x2 longhouse to the 256 ceiling on both axes', () => {
    // width  = (5+2)*64 = 448 -> clamp 256
    // height = (5+2)*32 + 1.5*64 = 224 + 96 = 320 -> clamp 256
    expect(VIEW_RECIPES['iso-3q'].nativeSize(buildingBrief({ w: 5, h: 2 }, 1.5)))
      .toEqual({ width: 256, height: 256 });
  });

  it('defaults footprint/heightUnits when absent', () => {
    const brief: AssetBrief = {
      kind: 'building', subject: 'x', traits: [], materials: [],
      view: 'iso-3q', era: 'medieval', paletteAnchors: [], negatives: [], seed: 0,
    };
    // width = (1+1)*64 = 128; height = (1+1)*32 + 1*64 = 128
    expect(VIEW_RECIPES['iso-3q'].nativeSize(brief)).toEqual({ width: 128, height: 128 });
  });
});
