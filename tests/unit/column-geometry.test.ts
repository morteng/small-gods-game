// tests/unit/column-geometry.test.ts — the kit's Column generator.
// One parametric vertical support (pier / post / shaft / baluster), with a base block,
// a (optionally tapered) shaft and a capital. These pin: it stands exactly `heightU`,
// a square shaft is an axis-aligned box of width 2·radius, taper genuinely narrows the
// top, and base/capital add girth at the ends.
import { describe, it, expect } from 'vitest';
import { solidColumn, columnProjector } from '@/assetgen/geometry/column';

describe('solidColumn', () => {
  it('a plain round shaft stands exactly heightU, watertight, ~2·radius wide', async () => {
    const m = await solidColumn([0, 0], { radiusU: 0.5, heightU: 4 });
    const bb = m.boundingBox();
    expect(bb.min[2]).toBeCloseTo(0, 5);
    expect(bb.max[2]).toBeCloseTo(4, 5);
    // a 32-gon circumscribes ~2·radius across (slightly under in x/y between facets)
    expect(bb.max[0] - bb.min[0]).toBeGreaterThan(0.95);
    expect(bb.max[0] - bb.min[0]).toBeLessThanOrEqual(1.0001);
    expect(m.genus()).toBe(0);
  });

  it('a square shaft is an axis-aligned box of width 2·radius (flats face the axes)', async () => {
    const m = await solidColumn([0, 0], { shape: 'square', radiusU: 0.5, heightU: 3 });
    const bb = m.boundingBox();
    // full width = 2·radius on BOTH axes, centred on the column axis (0,0)
    expect(bb.max[0] - bb.min[0]).toBeCloseTo(1, 3);
    expect(bb.max[1] - bb.min[1]).toBeCloseTo(1, 3);
    expect(bb.min[0]).toBeCloseTo(-0.5, 3);
    expect(bb.max[0]).toBeCloseTo(0.5, 3);
  });

  it('taper genuinely narrows the top — less volume than a parallel shaft of the same size', async () => {
    const straight = await solidColumn([0, 0], { shape: 'square', radiusU: 0.5, heightU: 4 });
    const tapered = await solidColumn([0, 0], { shape: 'square', radiusU: 0.5, topRadiusU: 0.3, heightU: 4 });
    expect(tapered.volume()).toBeLessThan(straight.volume());
    // the bottom footprint is unchanged…
    expect(tapered.boundingBox().min[0]).toBeCloseTo(-0.5, 3);
    expect(tapered.boundingBox().max[0]).toBeCloseTo(0.5, 3); // base still 2·radius wide
  });

  it('base + capital add girth without changing the overall height', async () => {
    const band = { heightU: 0.4, oversizeU: 0.25 };
    const bare = await solidColumn([0, 0], { shape: 'square', radiusU: 0.3, heightU: 5 });
    const dressed = await solidColumn([0, 0], { shape: 'square', radiusU: 0.3, heightU: 5, base: band, capital: band });
    expect(dressed.boundingBox().max[2]).toBeCloseTo(5, 5);          // same total height
    expect(dressed.boundingBox().min[2]).toBeCloseTo(0, 5);
    // plinth/abacus jut past the shaft, so the widest footprint grows
    expect(dressed.boundingBox().max[0]).toBeGreaterThan(bare.boundingBox().max[0]);
    expect(dressed.volume()).toBeGreaterThan(bare.volume());
  });

  it('columnProjector unwraps round shafts cylindrically and leaves square ones planar', () => {
    expect(columnProjector([0, 0], { radiusU: 0.5, heightU: 3, shape: 'round' })).toBeTypeOf('function');
    expect(columnProjector([0, 0], { radiusU: 0.5, heightU: 3, shape: 'square' })).toBeUndefined();
  });
});
