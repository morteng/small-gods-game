import { describe, it, expect } from 'vitest';
import { ART_RECIPE_VERSION, WORLD_CONTENT_VERSION } from '@/core/content-version';

describe('content-version constants', () => {
  it('declares the current art recipe version (v10: connectome-derived openings)', () => {
    expect(ART_RECIPE_VERSION).toBe('v10');
  });

  it('declares the current world content version (10: DC-3 enclosure barriers)', () => {
    expect(WORLD_CONTENT_VERSION).toBe(10);
  });
});
