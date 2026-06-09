// tests/unit/facet-material.test.ts
import { describe, it, expect } from 'vitest';
import { solidBox } from '@/assetgen/geometry/solids';
import { manifoldToFacets } from '@/assetgen/geometry/solids';

describe('facets carry their material', () => {
  it('manifoldToFacets stamps the Mat on every facet', async () => {
    const s = await solidBox([0, 0, 0], [1, 1, 1]);
    const facets = manifoldToFacets(s.getMesh(), 'thatch');
    expect(facets.length).toBeGreaterThan(0);
    expect(facets.every(f => f.mat === 'thatch')).toBe(true);
  });
});
