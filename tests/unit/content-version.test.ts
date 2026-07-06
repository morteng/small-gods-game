import { describe, it, expect } from 'vitest';
import { ART_RECIPE_VERSION, WORLD_CONTENT_VERSION } from '@/core/content-version';

describe('content-version constants', () => {
  it('declares the current art recipe version (v29: watermill waterwheel + sacred-spire proportioning)', () => {
    expect(ART_RECIPE_VERSION).toBe('v29');
  });

  it('declares the current world content version (86: rivers R1 — gradient-aware meanders)', () => {
    expect(WORLD_CONTENT_VERSION).toBe(86);
  });
});
