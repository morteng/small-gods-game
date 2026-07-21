import { describe, it, expect } from 'vitest';
import { ART_RECIPE_VERSION, WORLD_CONTENT_VERSION } from '@/core/content-version';

describe('content-version constants', () => {
  it('declares the current art recipe version (v36: stale-gate flush + palisade stagger/bank/post fidelity)', () => {
    expect(ART_RECIPE_VERSION).toBe('v36');
  });

  it('declares the current world content version (113: aridity-driven dust — vegetation placement dust gate retethered to slope/elevation/moisture)', () => {
    expect(WORLD_CONTENT_VERSION).toBe(113);
  });
});
