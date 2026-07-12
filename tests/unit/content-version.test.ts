import { describe, it, expect } from 'vitest';
import { ART_RECIPE_VERSION, WORLD_CONTENT_VERSION } from '@/core/content-version';

describe('content-version constants', () => {
  it('declares the current art recipe version (v31: hollow chimney flue + crown lip)', () => {
    expect(ART_RECIPE_VERSION).toBe('v31');
  });

  it('declares the current world content version (94: rivers R5 ground-blend — boulder settle pads + contact dirt)', () => {
    expect(WORLD_CONTENT_VERSION).toBe(94);
  });
});
