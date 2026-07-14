import { describe, it, expect } from 'vitest';
import { ART_RECIPE_VERSION, WORLD_CONTENT_VERSION } from '@/core/content-version';

describe('content-version constants', () => {
  it('declares the current art recipe version (v33: alpine flora — bare-crown variant + rock native-size variety)', () => {
    expect(ART_RECIPE_VERSION).toBe('v33');
  });

  it('declares the current world content version (98: ground-holds-it — water habitat, slope gate, rock settle pads)', () => {
    expect(WORLD_CONTENT_VERSION).toBe(98);
  });
});
