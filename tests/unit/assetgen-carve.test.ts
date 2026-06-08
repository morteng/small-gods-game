// tests/unit/assetgen-carve.test.ts
import { describe, it, expect } from 'vitest';
import { carveApertures, solidBox } from '@/assetgen/geometry/solids';

describe('carveApertures', () => {
  it('a box with no apertures is unchanged', async () => {
    const b = await solidBox([0, 0, 0], [2, 2, 2]);
    const c = await carveApertures(b, []);
    expect(c.volume()).toBeCloseTo(b.volume(), 3);
  });

  it('subtracting an aperture removes exactly the hole volume (no over/under-carve)', async () => {
    const b = await solidBox([0, 0, 0], [2, 2, 2]);          // volume 8
    // hole fully inside the box: 0.4 × 0.4 × 0.85 = 0.136 removed → 7.864
    const c = await carveApertures(b, [{ at: [0.8, 1.4, 0], size: [0.4, 0.4, 0.85] }]);
    expect(c.volume()).toBeCloseTo(8 - 0.4 * 0.4 * 0.85, 2);
  });
});
