// tests/unit/building-image-prompt.test.ts
import { describe, it, expect } from 'vitest';
import { buildingImagePrompt, imageModelFamily, geometryDescription } from '@/assetgen/building-image-prompt';
import { synthesizeBlueprint } from '@/blueprint/presets';

const GEMINI = 'google/gemini-2.5-flash-image';
const OPENAI = 'openai/gpt-5-image';

const FLUX = 'black-forest-labs/flux.2-klein-4b';

describe('imageModelFamily', () => {
  it('classifies by family', () => {
    expect(imageModelFamily(GEMINI)).toBe('gemini');
    expect(imageModelFamily(OPENAI)).toBe('openai');
    expect(imageModelFamily(FLUX)).toBe('flux');
    expect(imageModelFamily('black-forest-labs/flux.2-pro')).toBe('flux');
    expect(imageModelFamily('something/else')).toBe('generic');
  });
});

describe('FLUX prompt family', () => {
  it('uses positive-only background language (FLUX ignores negative prompts) and an i2i repaint instruction', () => {
    const rb = synthesizeBlueprint('cottage')!;
    const p = buildingImagePrompt(rb, FLUX);
    const lower = p.toLowerCase();
    // Demands the magenta chroma background for keying, stated POSITIVELY (no denials).
    expect(p).toContain('255,0,255');
    expect(lower).toContain('magenta');
    expect(lower).not.toContain('no ground');
    expect(lower).not.toContain('no shadow');
    // FLUX i2i: an edit instruction over the attached reference, not a from-scratch gen.
    expect(lower).toMatch(/repaint the attached|massing render/);
    expect(lower).toMatch(/isometric|2:1/);
    expect(p).not.toBe(buildingImagePrompt(rb, GEMINI));
  });

  it('is tight — no generic filler, subject leads the prompt', () => {
    const rb = synthesizeBlueprint('cottage')!;
    const p = buildingImagePrompt(rb, FLUX);
    // Subject-first ordering: the building noun appears before the edit verb.
    expect(p.indexOf('cottage')).toBeLessThan(p.toLowerCase().indexOf('repaint'));
    // No boilerplate padding words that assert nothing about THIS asset.
    expect(p.toLowerCase()).not.toMatch(/masterpiece|highly detailed|4k|trending|best quality/);
  });
});

describe('buildingImagePrompt', () => {
  it('is deterministic in (rb, model) and includes subject + era', () => {
    const rb = synthesizeBlueprint('cottage')!;
    expect(buildingImagePrompt(rb, GEMINI)).toBe(buildingImagePrompt(rb, GEMINI));
    const p = buildingImagePrompt(rb, GEMINI);
    expect(p).toContain('cottage');
    expect(p.toLowerCase()).toContain('medieval');
  });

  it('adapts the prompt to the model family', () => {
    const rb = synthesizeBlueprint('cottage')!;
    expect(buildingImagePrompt(rb, GEMINI)).not.toBe(buildingImagePrompt(rb, OPENAI));
  });

  it('reflects materials in the text', () => {
    const rb = synthesizeBlueprint('castle_keep')!;
    const p = buildingImagePrompt(rb, GEMINI);
    expect(p).toContain('castle keep');
    expect(p.toLowerCase()).toMatch(/stone|walls/);
  });

  it('invites rich texture/weathering instead of demanding an exact silhouette', () => {
    const rb = synthesizeBlueprint('cottage')!;
    for (const model of [GEMINI, OPENAI, 'something/else']) {
      const p = buildingImagePrompt(rb, model).toLowerCase();
      expect(p).not.toContain('exact silhouette');
      expect(p).not.toContain('shape exactly');
      expect(p).toMatch(/texture|weathering/);
    }
  });

  it('demands a solid magenta chroma background for keying (no "transparent")', () => {
    const rb = synthesizeBlueprint('cottage')!;
    const p = buildingImagePrompt(rb, GEMINI);
    expect(p).toContain('255,0,255');
    expect(p.toLowerCase()).toContain('magenta');
    expect(p.toLowerCase()).not.toContain('transparent background');
  });

  it('embeds a geometry-true element description + door facing in the prompt', () => {
    const rb = synthesizeBlueprint('tavern')!;
    const p = buildingImagePrompt(rb, GEMINI).toLowerCase();
    // The prompt must carry the explicit geometry description (counts + door),
    // scoped to what is visible from the render angle.
    expect(p).toContain('visible');
    expect(p).toMatch(/\bdoor\b/);
    expect(p).toContain('colour-coded by material');
  });
});

describe('vent truth — a smoke-louver is never mislabelled a chimney', () => {
  it('the cottage smoke-hole is described as a timber louver, NOT a chimney', () => {
    const rb = synthesizeBlueprint('cottage')!;
    const p = buildingImagePrompt(rb, FLUX).toLowerCase();
    expect(p).toContain('smoke-louver');
    expect(p).not.toContain('chimney rising');     // no chimney for the commoner cottage
    // and never the brick-chimney FLUX used to paint
    expect(p).not.toMatch(/\d+ (brick|stone) chimney/);
  });

  it('a real chimney is period-material — stone for medieval, brick only for current', () => {
    const tavern = synthesizeBlueprint('tavern')!;                 // medieval, real chimney vents
    expect(buildingImagePrompt(tavern, FLUX).toLowerCase()).toContain('stone chimney');
    expect(buildingImagePrompt(tavern, FLUX).toLowerCase()).not.toContain('brick chimney');
  });

  it('the shed roof states its slope direction (asymmetric, not symmetric)', () => {
    const rb = synthesizeBlueprint('cottage')!;
    (rb.parts[0].params as Record<string, unknown>).roof = 'lean_to';   // → runtime 'shed'
    const p = buildingImagePrompt(rb, FLUX).toLowerCase();
    expect(p).toContain('single-slope shed roof');
    expect(p).toMatch(/high at the rear|low front eave/);
  });
});

describe('geometryDescription', () => {
  it('counts the ACTUAL chimneys/windows/dormers on the blueprint', () => {
    const rb = synthesizeBlueprint('tavern')!;
    const ventCount = rb.parts.flatMap(p => p.features).filter(f => f.type === 'vent' && f.params.kind === 'chimney').length;
    const g = geometryDescription(rb);
    if (ventCount > 0) expect(g).toMatch(new RegExp(`${ventCount} stone chimneys`));
    expect(g).toContain('storey');
    expect(g.toLowerCase()).toMatch(/door on the (front|rear)/);
  });

  it('describes the door face with its iso screen direction', () => {
    const rb = synthesizeBlueprint('tavern')!;
    const doorFace = rb.parts.flatMap(p => p.features).find(f => f.type === 'door')?.face ?? 'south';
    const g = geometryDescription(rb).toLowerCase();
    const expected = { south: 'lower-left', east: 'lower-right', north: 'upper-right', west: 'upper-left' }[doorFace];
    expect(g).toContain(expected);
  });

  it('returns empty for non-building classes', () => {
    const tree = synthesizeBlueprint('oak_tree');
    if (tree) expect(geometryDescription(tree)).toBe('');
  });
});
