import { describe, it, expect } from 'vitest';
import { ART_RECIPE_VERSION, WORLD_CONTENT_VERSION } from '@/core/content-version';

describe('content-version constants', () => {
  it('declares the current art recipe version (v24: roof vocabulary + tessellation + trim + finishes)', () => {
    expect(ART_RECIPE_VERSION).toBe('v24');
  });

  it('declares the current world content version (80: round 5 — gates-first commit, trample prewarm, fillet raster reconciliation)', () => {
    expect(WORLD_CONTENT_VERSION).toBe(80);
  });
});
