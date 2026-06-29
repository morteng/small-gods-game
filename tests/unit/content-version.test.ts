import { describe, it, expect } from 'vitest';
import { ART_RECIPE_VERSION, WORLD_CONTENT_VERSION } from '@/core/content-version';

describe('content-version constants', () => {
  it('declares the current art recipe version (v20: temple retired → generative)', () => {
    expect(ART_RECIPE_VERSION).toBe('v20');
  });

  it('declares the current world content version (39: temple retired → generative)', () => {
    expect(WORLD_CONTENT_VERSION).toBe(39);
  });
});
