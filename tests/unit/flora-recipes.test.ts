// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { buildFloraSkeleton, FLORA_RECIPE_NAMES } from '@/assetgen/geometry/flora/recipes';
import { createRng } from '@/core/rng';

describe('flora recipes', () => {
  it('every recipe produces a non-empty skeleton', () => {
    for (const recipe of FLORA_RECIPE_NAMES) {
      const skel = buildFloraSkeleton({ recipe, heightTiles: 5, baseRadius: 0.1, rng: createRng(3) });
      expect(skel.limbs.length, recipe).toBeGreaterThan(0);
    }
  });

  it('scales the skeleton so its tallest point ≈ target height', () => {
    const skel = buildFloraSkeleton({ recipe: 'oak', heightTiles: 8, baseRadius: 0.1, rng: createRng(5) });
    const maxZ = Math.max(...skel.limbs.flatMap(l => [l.a[2], l.b[2]]));
    expect(maxZ).toBeCloseTo(8, 5);
  });

  it('is deterministic for a fixed seed', () => {
    const a = buildFloraSkeleton({ recipe: 'oak', heightTiles: 6, baseRadius: 0.1, rng: createRng(11) });
    const b = buildFloraSkeleton({ recipe: 'oak', heightTiles: 6, baseRadius: 0.1, rng: createRng(11) });
    expect(a.limbs).toEqual(b.limbs);
    expect(a.leaves).toEqual(b.leaves);
  });

  it('leafless recipes (fern uses tiny leaves; flowers have a whorl)', () => {
    const flower = buildFloraSkeleton({ recipe: 'flower', heightTiles: 1, baseRadius: 0.02, rng: createRng(2) });
    expect(flower.leaves.length).toBeGreaterThan(0);
  });
});
