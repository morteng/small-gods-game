import { describe, it, expect } from 'vitest';
import { PixfluxCompiler } from '@/assetgen/compilers/pixflux-compiler';
import { describeForHuman } from '@/assetgen/describe';
import { buildingBrief } from '@/assetgen/producers/building-producer';
import { VIEW_RECIPES } from '@/assetgen/view-registry';
import type { AssetBrief } from '@/assetgen/asset-brief';
import type { BuildingDescriptor } from '@/world/building-descriptor';

const cottage: BuildingDescriptor = {
  preset: 'cottage', category: 'residential', era: 'medieval',
  footprint: { w: 3, h: 3 }, plan: 'rect', levels: 1, levelInset: 0,
  heightPerLevel: 1, roof: 'gable', walls: 'wattle', roofMat: 'thatch',
  groundMaterial: 'dirt', door: { x: 1, y: 2 },
};

const compiler = new PixfluxCompiler();

describe('PixfluxCompiler', () => {
  it('drives iso via request fields, not a text hint, and keeps subject/door/material', () => {
    const opts = compiler.compile(buildingBrief(cottage, 1));
    expect(opts.isometric).toBe(true);
    expect(opts.view).toBe('high top-down');
    expect(opts.textGuidanceScale).toBe(13);
    expect(opts.prompt).not.toContain('isometric, 3/4 top-down view');
    expect(opts.prompt).toContain('cottage');
    // door {x:1,y:2} on a 3x3 → 's' face → front-left wall, view-relative phrasing.
    expect(opts.prompt).toContain('front-left wall facing the viewer');
    expect(opts.prompt).toContain('wattle');
    expect(opts.prompt).toContain('thatch');
  });

  it('puts negatives in negative_description, not jammed into the prompt', () => {
    const opts = compiler.compile(buildingBrief(cottage, 1));
    expect(opts.prompt).not.toContain('avoid:');
    expect(opts.negativeDescription ?? '').toContain('blurry');
  });

  it('bakes the canonical upper-left sun direction into every prompt', () => {
    expect(compiler.compile(buildingBrief(cottage, 1)).prompt).toContain('upper-left');
  });

  it('takes size + recipeVersion from the view registry', () => {
    const brief = buildingBrief(cottage, 1);
    const expected = VIEW_RECIPES['iso-3q'].nativeSize(brief);
    const opts = compiler.compile(brief);
    expect(opts.width).toBe(expected.width);
    expect(opts.height).toBe(expected.height);
    expect(opts.recipeVersion).toBe('v2');
  });

  it('omits initImageStrength for text-only buildings, sets it when guidance is given', () => {
    // Buildings are generated text-only (guidance 'none') → no init strength.
    expect(compiler.compile(buildingBrief(cottage, 1)).initImageStrength).toBeUndefined();

    const guided: AssetBrief = { ...buildingBrief(cottage, 1), guidance: { source: 'massing', strength: 300 } };
    expect(compiler.compile(guided).initImageStrength).toBe(300);
  });

  it('passes palette anchors through', () => {
    const opts = compiler.compile(buildingBrief(cottage, 1));
    expect(opts.paletteAnchors).toContain('#b29162'); // wattle
    expect(opts.paletteAnchors).toContain('#c9a227'); // thatch
  });

  it('tri-alignment: description and prompt share subject/material/door tokens', () => {
    const brief = buildingBrief(cottage, 1);
    const human = describeForHuman(brief).toLowerCase();
    const prompt = compiler.compile(brief).prompt.toLowerCase();
    for (const token of ['cottage', 'wattle', 'thatch', 'front-left']) {
      expect(human).toContain(token);
      expect(prompt).toContain(token);
    }
  });
});
