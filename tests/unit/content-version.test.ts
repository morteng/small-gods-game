import { describe, it, expect } from 'vitest';
import { ART_RECIPE_VERSION, WORLD_CONTENT_VERSION } from '@/core/content-version';

describe('content-version constants', () => {
  it('declares the current art recipe version (v18: L3b bay-aware openings)', () => {
    expect(ART_RECIPE_VERSION).toBe('v18');
  });

  it('declares the current world content version (36: village density)', () => {
    expect(WORLD_CONTENT_VERSION).toBe(36);
  });
});
