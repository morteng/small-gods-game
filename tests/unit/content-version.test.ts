import { describe, it, expect } from 'vitest';
import { ART_RECIPE_VERSION, WORLD_CONTENT_VERSION } from '@/core/content-version';

describe('content-version constants', () => {
  it('declares the current art recipe version (v32: stair geometry upgrade — nosing/cheeks/coursing)', () => {
    expect(ART_RECIPE_VERSION).toBe('v32');
  });

  it('declares the current world content version (96: anchor-driven stairs)', () => {
    expect(WORLD_CONTENT_VERSION).toBe(96);
  });
});
