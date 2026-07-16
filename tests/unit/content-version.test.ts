import { describe, it, expect } from 'vitest';
import { ART_RECIPE_VERSION, WORLD_CONTENT_VERSION } from '@/core/content-version';

describe('content-version constants', () => {
  it('declares the current art recipe version (v34: bridge decks carry the road — roadway surface course)', () => {
    expect(ART_RECIPE_VERSION).toBe('v34');
  });

  it('declares the current world content version (99: wooden arch bridges are the default crossing — timber class = hump-backed arch, stone footings on every class)', () => {
    expect(WORLD_CONTENT_VERSION).toBe(99);
  });
});
