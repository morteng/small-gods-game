import { describe, it, expect } from 'vitest';
import { buildingImagePrompt, BUILDING_STYLE_PREAMBLE } from '@/assetgen/building-image-prompt';
import { synthesizeBlueprint } from '@/blueprint/presets/index';

describe('buildingImagePrompt', () => {
  it('is deterministic and includes style preamble + subject + era', () => {
    const rb = synthesizeBlueprint('cottage')!;
    const a = buildingImagePrompt(rb);
    const b = buildingImagePrompt(rb);
    expect(a).toBe(b);                       // stable → cache-key safe
    expect(a.startsWith(BUILDING_STYLE_PREAMBLE)).toBe(true);
    expect(a).toContain('cottage');
    expect(a.toLowerCase()).toContain('medieval');
  });

  it('reflects materials in the text', () => {
    const rb = synthesizeBlueprint('castle_keep')!;
    const p = buildingImagePrompt(rb);
    expect(p).toContain('castle keep');
    expect(p.toLowerCase()).toMatch(/stone|walls/);
  });
});
