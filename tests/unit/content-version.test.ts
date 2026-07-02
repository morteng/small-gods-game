import { describe, it, expect } from 'vitest';
import { ART_RECIPE_VERSION, WORLD_CONTENT_VERSION } from '@/core/content-version';

describe('content-version constants', () => {
  it('declares the current art recipe version (v24: roof vocabulary + tessellation + trim + finishes)', () => {
    expect(ART_RECIPE_VERSION).toBe('v24');
  });

  it('declares the current world content version (76: volcanic identity + world doctor + ground easing)', () => {
    expect(WORLD_CONTENT_VERSION).toBe(76);
  });
});
