import { describe, it, expect } from 'vitest';
import { ART_RECIPE_VERSION, WORLD_CONTENT_VERSION } from '@/core/content-version';

describe('content-version constants', () => {
  it('declares the current art recipe version (v16: fabric gated by structure)', () => {
    expect(ART_RECIPE_VERSION).toBe('v16');
  });

  it('declares the current world content version (31: manor premises — stable + well)', () => {
    expect(WORLD_CONTENT_VERSION).toBe(31);
  });
});
