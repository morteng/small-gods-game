import { describe, it, expect } from 'vitest';
import { ART_RECIPE_VERSION, WORLD_CONTENT_VERSION } from '@/core/content-version';

describe('content-version constants', () => {
  it('declares the current art recipe version (v5: adaptive registration + rebuilt keep)', () => {
    expect(ART_RECIPE_VERSION).toBe('v5');
  });

  it('declares the current world content version', () => {
    expect(WORLD_CONTENT_VERSION).toBe(1);
  });
});
