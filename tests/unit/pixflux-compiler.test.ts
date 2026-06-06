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
  it('emits iso phrasing, subject, door face and a material word', () => {
    const opts = compiler.compile(buildingBrief(cottage, 1));
    expect(opts.prompt).toContain('isometric, 3/4 top-down view');
    expect(opts.prompt).toContain('cottage');
    expect(opts.prompt).toContain('door on the south side');
    expect(opts.prompt).toContain('wattle');
    expect(opts.prompt).toContain('thatch');
  });

  it('takes size + recipeVersion from the view registry', () => {
    const brief = buildingBrief(cottage, 1);
    const expected = VIEW_RECIPES['iso-3q'].nativeSize(brief);
    const opts = compiler.compile(brief);
    expect(opts.width).toBe(expected.width);
    expect(opts.height).toBe(expected.height);
    expect(opts.recipeVersion).toBe('v1');
  });

  it('sets initImageStrength when guidance is massing, absent otherwise', () => {
    expect(compiler.compile(buildingBrief(cottage, 1)).initImageStrength).toBe(500);

    const noGuide: AssetBrief = { ...buildingBrief(cottage, 1), guidance: { source: 'none', strength: 0 } };
    expect(compiler.compile(noGuide).initImageStrength).toBeUndefined();
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
    for (const token of ['cottage', 'wattle', 'thatch', 'south']) {
      expect(human).toContain(token);
      expect(prompt).toContain(token);
    }
  });
});
