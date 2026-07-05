import { describe, it, expect } from 'vitest';
import { ART_RECIPE_VERSION, WORLD_CONTENT_VERSION } from '@/core/content-version';

describe('content-version constants', () => {
  it('declares the current art recipe version (v26: doghouse dormer geometry fix)', () => {
    expect(ART_RECIPE_VERSION).toBe('v26');
  });

  it('declares the current world content version (86: rivers R1 — gradient-aware meanders)', () => {
    expect(WORLD_CONTENT_VERSION).toBe(86);
  });
});
