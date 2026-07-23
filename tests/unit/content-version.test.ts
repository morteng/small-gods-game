import { describe, it, expect } from 'vitest';
import { ART_RECIPE_VERSION, WORLD_CONTENT_VERSION } from '@/core/content-version';

describe('content-version constants', () => {
  it('declares the current art recipe version (v36: stale-gate flush + palisade stagger/bank/post fidelity)', () => {
    expect(ART_RECIPE_VERSION).toBe('v36');
  });

  it('declares the current world content version (118: road-grade stairs now measure grade in RENDER space (curveRenderElev) so a gentle rise the terrain-gamma flattens on screen no longer fires a dressed-stone monument standing on flat ground beside the road — the detection threshold and the placement geometry both agree with the drawn terrain)', () => {
    expect(WORLD_CONTENT_VERSION).toBe(118);
  });
});
