// tests/unit/assetgen-types.test.ts
import { describe, it, expect } from 'vitest';
import { MATERIAL_RGB } from '@/assetgen/types';

describe('assetgen types', () => {
  it('exposes a base RGB for every material', () => {
    for (const m of ['stone','timber','plaster','thatch','tile','foliage','bark','earth','metal'] as const) {
      const c = MATERIAL_RGB[m];
      expect(c).toHaveLength(3);
      for (const ch of c) { expect(ch).toBeGreaterThanOrEqual(0); expect(ch).toBeLessThanOrEqual(255); }
    }
  });
});
