// tests/unit/blueprint-opening.test.ts
import { describe, it, expect } from 'vitest';
import { isOpening } from '@/blueprint/features/opening';
import type { FeatureType } from '@/blueprint/registry';

const plain: FeatureType = {
  type: 'plain', paramSchema: {}, resolve: () => ({ params: {} }), toBrief: () => 'plain',
};
const opening: FeatureType = {
  ...plain, type: 'opening', threshold: true,
  aperture: () => ({ face: 'south', t: 0.5, sill: 0, halfW: 0.2, height: 0.85, depth: 0.3 }),
  filler: () => [],
};

describe('opening contract', () => {
  it('isOpening is true only when a kind declares an aperture hook', () => {
    expect(isOpening(opening)).toBe(true);
    expect(isOpening(plain)).toBe(false);
    expect(isOpening(undefined)).toBe(false);
  });
});
