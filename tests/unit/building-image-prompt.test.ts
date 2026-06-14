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
  it('uses positive-only background language (FLUX ignores negative prompts) and the "image 1" editing convention', () => {
    const rb = synthesizeBlueprint('cottage')!;
    const p = buildingImagePrompt(rb, FLUX);
    const lower = p.toLowerCase();
    // Still demands the magenta chroma background for keying…
    expect(p).toContain('255,0,255');
    expect(lower).toContain('magenta');
    // …but as a positive instruction, NOT the gemini "no ground, no shadow" denial.
    expect(lower).not.toContain('no ground');
    expect(lower).not.toContain('no shadow');
    // FLUX editing: address the init as "image 1".
    expect(lower).toContain('image 1');
    expect(lower).toMatch(/isometric|2:1/);
    expect(p).not.toBe(buildingImagePrompt(rb, GEMINI));
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

  it('invites architectural detail instead of demanding an exact silhouette', () => {
    const rb = synthesizeBlueprint('cottage')!;
    for (const model of [GEMINI, OPENAI, 'something/else']) {
      const p = buildingImagePrompt(rb, model).toLowerCase();
      expect(p).not.toContain('exact silhouette');
      expect(p).not.toContain('shape exactly');
      expect(p).toMatch(/detail/);
    }
  });

  it('demands a solid magenta chroma background for keying (no "transparent")', () => {
    const rb = synthesizeBlueprint('cottage')!;
    const p = buildingImagePrompt(rb, GEMINI);
    expect(p).toContain('255,0,255');
    expect(p.toLowerCase()).toContain('magenta');
    expect(p.toLowerCase()).not.toContain('transparent background');
  });

  it('embeds a geometry-true element count + door facing in the prompt', () => {
    const rb = synthesizeBlueprint('tavern')!;
    const p = buildingImagePrompt(rb, GEMINI).toLowerCase();
    // The prompt must carry the explicit geometry description (counts + door),
    // scoped to what is visible from the render angle.
    expect(p).toContain('match exactly');
    expect(p).toContain('visible');
    expect(p).toMatch(/\bdoor\b/);
    expect(p).toContain('colour-coded by material');
  });
});

describe('geometryDescription', () => {
  it('counts the ACTUAL chimneys/windows/dormers on the blueprint', () => {
    const rb = synthesizeBlueprint('tavern')!;
    const ventCount = rb.parts.flatMap(p => p.features).filter(f => f.type === 'vent').length;
    const g = geometryDescription(rb);
    if (ventCount > 0) expect(g).toMatch(new RegExp(`exactly ${ventCount} chimney`));
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
