import { describe, it, expect } from 'vitest';
import { ART_RECIPE_VERSION, WORLD_CONTENT_VERSION } from '@/core/content-version';

describe('content-version constants', () => {
  it('declares the current art recipe version (v35: rock faceting — plane-cut knapped rocks + outcrop shelves)', () => {
    expect(ART_RECIPE_VERSION).toBe('v35');
  });

  it('declares the current world content version (108: rock outcrops join the alpine pool + size-keyed rock snow burial)', () => {
    expect(WORLD_CONTENT_VERSION).toBe(109);
  });
});
