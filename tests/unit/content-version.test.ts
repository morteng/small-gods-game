import { describe, it, expect } from 'vitest';
import { ART_RECIPE_VERSION, WORLD_CONTENT_VERSION } from '@/core/content-version';

describe('content-version constants', () => {
  it('declares the current art recipe version (v22: E3 threshold stoup)', () => {
    expect(ART_RECIPE_VERSION).toBe('v22');
  });

  it('declares the current world content version (50: G7 irrigation ditches)', () => {
    expect(WORLD_CONTENT_VERSION).toBe(50);
  });
});
