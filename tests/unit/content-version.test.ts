import { describe, it, expect } from 'vitest';
import { ART_RECIPE_VERSION, WORLD_CONTENT_VERSION } from '@/core/content-version';

describe('content-version constants', () => {
  it('declares the current art recipe version (v7: deep sprocketed eaves)', () => {
    expect(ART_RECIPE_VERSION).toBe('v7');
  });

  it('declares the current world content version', () => {
    expect(WORLD_CONTENT_VERSION).toBe(3);
  });
});
