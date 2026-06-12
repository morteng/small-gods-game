import { describe, it, expect } from 'vitest';
import { ART_RECIPE_VERSION, WORLD_CONTENT_VERSION } from '@/core/content-version';

describe('content-version constants', () => {
  it('declares the current art recipe version (v6: medieval detail pass)', () => {
    expect(ART_RECIPE_VERSION).toBe('v6');
  });

  it('declares the current world content version', () => {
    expect(WORLD_CONTENT_VERSION).toBe(2);
  });
});
