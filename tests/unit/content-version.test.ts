import { describe, it, expect } from 'vitest';
import { ART_RECIPE_VERSION, WORLD_CONTENT_VERSION } from '@/core/content-version';

describe('content-version constants', () => {
  it('declares the current art recipe version (v34: bridge decks carry the road — roadway surface course)', () => {
    expect(ART_RECIPE_VERSION).toBe('v34');
  });

  it('declares the current world content version (102: road A*/drawing fix round — metre-true grade, bow pins, real repair edges, node tangent fillets)', () => {
    expect(WORLD_CONTENT_VERSION).toBe(103);
  });
});
