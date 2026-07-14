import { describe, it, expect } from 'vitest';
import { ART_RECIPE_VERSION, WORLD_CONTENT_VERSION } from '@/core/content-version';

describe('content-version constants', () => {
  it('declares the current art recipe version (v34: bridge decks carry the road — roadway surface course)', () => {
    expect(ART_RECIPE_VERSION).toBe('v34');
  });

  it('declares the current world content version (98: bridges seat on the composed terrain, or do not exist)', () => {
    expect(WORLD_CONTENT_VERSION).toBe(98);
  });
});
