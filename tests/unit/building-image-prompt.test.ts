// tests/unit/building-image-prompt.test.ts
import { describe, it, expect } from 'vitest';
import { buildingImagePrompt, imageModelFamily } from '@/assetgen/building-image-prompt';
import { synthesizeBlueprint } from '@/blueprint/presets';

const GEMINI = 'google/gemini-2.5-flash-image';
const OPENAI = 'openai/gpt-5-image';

describe('imageModelFamily', () => {
  it('classifies by family', () => {
    expect(imageModelFamily(GEMINI)).toBe('gemini');
    expect(imageModelFamily(OPENAI)).toBe('openai');
    expect(imageModelFamily('something/else')).toBe('generic');
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

  it('demands a solid magenta chroma background for keying (no "transparent")', () => {
    const rb = synthesizeBlueprint('cottage')!;
    const p = buildingImagePrompt(rb, GEMINI);
    expect(p).toContain('255,0,255');
    expect(p.toLowerCase()).toContain('magenta');
    expect(p.toLowerCase()).not.toContain('transparent background');
  });
});
