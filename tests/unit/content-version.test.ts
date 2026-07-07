import { describe, it, expect } from 'vitest';
import { ART_RECIPE_VERSION, WORLD_CONTENT_VERSION } from '@/core/content-version';

describe('content-version constants', () => {
  it('declares the current art recipe version (v30: stone-lower-half watermill + submerged wheel)', () => {
    expect(ART_RECIPE_VERSION).toBe('v30');
  });

  it('declares the current world content version (89: bridges/stairs seat on visible water + de-pile)', () => {
    expect(WORLD_CONTENT_VERSION).toBe(89);
  });
});
