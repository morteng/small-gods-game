import { describe, it, expect } from 'vitest';
import { ART_RECIPE_VERSION, WORLD_CONTENT_VERSION } from '@/core/content-version';

describe('content-version constants', () => {
  it('declares the current art recipe version (v36: stale-gate flush + palisade stagger/bank/post fidelity)', () => {
    expect(ART_RECIPE_VERSION).toBe('v36');
  });

  it('declares the current world content version (115: render+worldgen believability — orphaned entrance stoops re-sited after water reconcile, bridge deck seated on the pinned road ribbon, rocks culled off steep river-carved banks)', () => {
    expect(WORLD_CONTENT_VERSION).toBe(115);
  });
});
