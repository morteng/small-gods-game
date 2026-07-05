import { describe, it, expect } from 'vitest';
import { ART_RECIPE_VERSION, WORLD_CONTENT_VERSION } from '@/core/content-version';

describe('content-version constants', () => {
  it('declares the current art recipe version (v25: wall plank orientation + timber realism)', () => {
    expect(ART_RECIPE_VERSION).toBe('v25');
  });

  it('declares the current world content version (83: WP-W1 — canonical 8-bearing wall rings on the 2-tile piece grid, gate piece slots)', () => {
    expect(WORLD_CONTENT_VERSION).toBe(84);
  });
});
