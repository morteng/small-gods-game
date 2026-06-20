import { describe, it, expect } from 'vitest';
import { ART_RECIPE_VERSION, WORLD_CONTENT_VERSION } from '@/core/content-version';

describe('content-version constants', () => {
  it('declares the current art recipe version (v12: lit windows / glass emissive)', () => {
    expect(ART_RECIPE_VERSION).toBe('v12');
  });

  it('declares the current world content version (11: default-world height curve)', () => {
    expect(WORLD_CONTENT_VERSION).toBe(11);
  });
});
