import { describe, it, expect } from 'vitest';
import { ART_RECIPE_VERSION, WORLD_CONTENT_VERSION } from '@/core/content-version';

describe('content-version constants', () => {
  it('declares the current art recipe version (v13: real flora generators)', () => {
    expect(ART_RECIPE_VERSION).toBe('v13');
  });

  it('declares the current world content version (21: aqueduct arcade G6 polish)', () => {
    expect(WORLD_CONTENT_VERSION).toBe(21);
  });
});
