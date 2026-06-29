import { describe, it, expect } from 'vitest';
import { ART_RECIPE_VERSION, WORLD_CONTENT_VERSION } from '@/core/content-version';

describe('content-version constants', () => {
  it('declares the current art recipe version (v19: L3b undercroft base course)', () => {
    expect(ART_RECIPE_VERSION).toBe('v19');
  });

  it('declares the current world content version (38: L3b undercroft + townhouse roster)', () => {
    expect(WORLD_CONTENT_VERSION).toBe(38);
  });
});
