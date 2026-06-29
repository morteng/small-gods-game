import { describe, it, expect } from 'vitest';
import { ART_RECIPE_VERSION, WORLD_CONTENT_VERSION } from '@/core/content-version';

describe('content-version constants', () => {
  it('declares the current art recipe version (v21: E3 axis-mundi spire)', () => {
    expect(ART_RECIPE_VERSION).toBe('v21');
  });

  it('declares the current world content version (39: temple retired → generative)', () => {
    expect(WORLD_CONTENT_VERSION).toBe(39);
  });
});
