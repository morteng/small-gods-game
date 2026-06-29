import { describe, it, expect } from 'vitest';
import { ART_RECIPE_VERSION, WORLD_CONTENT_VERSION } from '@/core/content-version';

describe('content-version constants', () => {
  it('declares the current art recipe version (v17: L2b form footprint variety)', () => {
    expect(ART_RECIPE_VERSION).toBe('v17');
  });

  it('declares the current world content version (35: settlement size scaling)', () => {
    expect(WORLD_CONTENT_VERSION).toBe(35);
  });
});
