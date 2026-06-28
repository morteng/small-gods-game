import { describe, it, expect } from 'vitest';
import { ART_RECIPE_VERSION, WORLD_CONTENT_VERSION } from '@/core/content-version';

describe('content-version constants', () => {
  it('declares the current art recipe version (v16: fabric gated by structure)', () => {
    expect(ART_RECIPE_VERSION).toBe('v16');
  });

  it('declares the current world content version (32: E4 roster sweep — village/town trades)', () => {
    expect(WORLD_CONTENT_VERSION).toBe(32);
  });
});
