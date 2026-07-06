import { describe, it, expect } from 'vitest';
import { ART_RECIPE_VERSION, WORLD_CONTENT_VERSION } from '@/core/content-version';

describe('content-version constants', () => {
  it('declares the current art recipe version (v30: stone-lower-half watermill + submerged wheel)', () => {
    expect(ART_RECIPE_VERSION).toBe('v30');
  });

  it('declares the current world content version (87: watermill flush-to-stream siting)', () => {
    expect(WORLD_CONTENT_VERSION).toBe(87);
  });
});
