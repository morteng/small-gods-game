import { describe, it, expect } from 'vitest';
import { ART_RECIPE_VERSION, WORLD_CONTENT_VERSION } from '@/core/content-version';

describe('content-version constants', () => {
  it('declares the current art recipe version (v24: roof vocabulary + tessellation + trim + finishes)', () => {
    expect(ART_RECIPE_VERSION).toBe('v24');
  });

  it('declares the current world content version (78: WP-C junction reconciliation — croft gates, deck seating, river-bridge fix)', () => {
    expect(WORLD_CONTENT_VERSION).toBe(78);
  });
});
