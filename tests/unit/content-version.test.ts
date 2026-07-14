import { describe, it, expect } from 'vitest';
import { ART_RECIPE_VERSION, WORLD_CONTENT_VERSION } from '@/core/content-version';

describe('content-version constants', () => {
  it('declares the current art recipe version (v32: stair geometry upgrade — nosing/cheeks/coursing)', () => {
    expect(ART_RECIPE_VERSION).toBe('v32');
  });

  it('declares the current world content version (95: flora density dial + ground-cover baseline)', () => {
    expect(WORLD_CONTENT_VERSION).toBe(95);
  });
});
