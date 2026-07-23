import { describe, it, expect } from 'vitest';
import { ART_RECIPE_VERSION, WORLD_CONTENT_VERSION } from '@/core/content-version';

describe('content-version constants', () => {
  it('declares the current art recipe version (v36: stale-gate flush + palisade stagger/bank/post fidelity)', () => {
    expect(ART_RECIPE_VERSION).toBe('v36');
  });

  it('declares the current world content version (117: riverbank believability — offset bridges now seat dry-to-dry across the water (nearestDry snap when the ribbon ends mid-channel), reeds hug the waterline (EMERGENT_BAND_TILES 0.9→0.3), and render-only aridity-shifted grass cull clears vegetation off steep rocky banks)', () => {
    expect(WORLD_CONTENT_VERSION).toBe(117);
  });
});
