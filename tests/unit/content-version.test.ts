import { describe, it, expect } from 'vitest';
import { ART_RECIPE_VERSION, WORLD_CONTENT_VERSION } from '@/core/content-version';

describe('content-version constants', () => {
  it('declares the current art recipe version (v36: wall foundation skirts — buried below-grade footing on curtains + towers)', () => {
    expect(ART_RECIPE_VERSION).toBe('v36');
  });

  it('declares the current world content version (110: walls sit the ground — terraced per-piece footing + wall-base wear)', () => {
    expect(WORLD_CONTENT_VERSION).toBe(110);
  });
});
