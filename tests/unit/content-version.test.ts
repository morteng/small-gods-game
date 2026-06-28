import { describe, it, expect } from 'vitest';
import { ART_RECIPE_VERSION, WORLD_CONTENT_VERSION } from '@/core/content-version';

describe('content-version constants', () => {
  it('declares the current art recipe version (v14: structure axis gates form)', () => {
    expect(ART_RECIPE_VERSION).toBe('v14');
  });

  it('declares the current world content version (28: terrain-aware site selection)', () => {
    expect(WORLD_CONTENT_VERSION).toBe(28);
  });
});
