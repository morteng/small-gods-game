import { describe, it, expect } from 'vitest';
import { ART_RECIPE_VERSION, WORLD_CONTENT_VERSION } from '@/core/content-version';

describe('content-version constants', () => {
  it('declares the current art recipe version (v15: form derived from structure)', () => {
    expect(ART_RECIPE_VERSION).toBe('v15');
  });

  it('declares the current world content version (28: terrain-aware site selection)', () => {
    expect(WORLD_CONTENT_VERSION).toBe(28);
  });
});
