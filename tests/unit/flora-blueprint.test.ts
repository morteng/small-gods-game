// @vitest-environment node
// Integration: the new branching-flora / rock presets resolve through the
// Blueprint pipeline and compose into a non-empty sprite (same path as buildings).
import { describe, it, expect } from 'vitest';
import { synthesizeBlueprint } from '@/blueprint/presets';
import { toGeometry } from '@/blueprint/compile/to-geometry';
import { composeStructure } from '@/assetgen/compose';
import { rockSizeFactor, ROCK_GAME_SCALE } from '@/blueprint/parts/flora-branch';
import { FLORA_BARE_VARIANT, floraVariantSeed } from '@/render/flora-variant';
import { canonicalJson } from '@/render/generated-art-cache';
import { mToTiles } from '@/render/scale-contract';

describe('flora blueprint integration', () => {
  it('branching plant presets emit a flora prim', () => {
    for (const preset of ['oak_branched', 'pine_branched', 'willow_tree', 'shrub_bush', 'bracken_fern', 'wildflower']) {
      const rb = synthesizeBlueprint(preset);
      expect(rb, preset).toBeTruthy();
      const spec = toGeometry(rb!);
      expect(spec.parts.some(p => p.prim === 'flora'), preset).toBe(true);
    }
  });

  it('rock presets emit a rock prim', () => {
    const spec = toGeometry(synthesizeBlueprint('boulder')!);
    expect(spec.parts.some(p => p.prim === 'rock')).toBe(true);
  });

  it('is deterministic per species (same blueprint twice → identical geometry)', () => {
    const a = JSON.stringify(toGeometry(synthesizeBlueprint('oak_branched')!));
    const b = JSON.stringify(toGeometry(synthesizeBlueprint('oak_branched')!));
    expect(a).toBe(b);
  });

  it('composes oak_branched into a non-empty sprite', async () => {
    const r = await composeStructure(toGeometry(synthesizeBlueprint('oak_branched')!));
    expect(r.bbox.w).toBeGreaterThan(0);
    expect(r.bbox.h).toBeGreaterThan(0);
  });

  it('composes a boulder into a non-empty sprite', async () => {
    const r = await composeStructure(toGeometry(synthesizeBlueprint('boulder')!));
    expect(r.bbox.w).toBeGreaterThan(0);
    expect(r.bbox.h).toBeGreaterThan(0);
  });
});

/** The compose spec ParametricPlantSource builds for a (kind, variant) — see
 *  parametric-plant-source.ts: the variant seed drives the blueprint, and the BARE slot
 *  re-composes the variant-0 skeleton with `bare:1` patched onto its branch_plant parts. */
function variantSpec(kind: string, variant: number) {
  const bare = variant === FLORA_BARE_VARIANT;
  const rb = synthesizeBlueprint(kind, [], floraVariantSeed(kind, bare ? 0 : variant))!;
  if (bare) {
    for (const part of rb.parts) {
      if (part.type === 'branch_plant') part.params = { ...part.params, bare: 1 };
    }
  }
  return toGeometry(rb);
}

const floraPrim = (spec: ReturnType<typeof toGeometry>) =>
  spec.parts.find(p => p.prim === 'flora') as Extract<(typeof spec.parts)[number], { prim: 'flora' }>;
const rockPrim = (spec: ReturnType<typeof toGeometry>) =>
  spec.parts.find(p => p.prim === 'rock') as Extract<(typeof spec.parts)[number], { prim: 'rock' }>;

describe('rock native-size variety (the seeded variants are different NATIVE sizes)', () => {
  it('VARIANT 0 IS BYTE-IDENTICAL: the size factor is EXACTLY 1 at seed 0', () => {
    // The load-bearing convention — variant 0 reuses its existing cache slot, and the
    // golden fixtures hold. Exact equality, not a tolerance: any float drift is a miss.
    expect(rockSizeFactor(0)).toBe(1);
    expect(floraVariantSeed('boulder', 0)).toBe(0);
    // …and the whole way through the pipeline: the boulder's radius is its unperturbed
    // metric size (2.5 m diameter × ROCK_GAME_SCALE, in tiles, halved to a radius).
    expect(rockPrim(variantSpec('boulder', 0)).radius).toBe(mToTiles(2.5 * ROCK_GAME_SCALE) / 2);
  });

  it('the variant-0 spec is stable across rebuilds (one cache slot, not a moving target)', () => {
    expect(canonicalJson(variantSpec('boulder', 0))).toBe(canonicalJson(variantSpec('boulder', 0)));
  });

  it('variants 1..V-1 come out at genuinely DIFFERENT native sizes, within ±20 %', () => {
    const base = rockPrim(variantSpec('boulder', 0)).radius;
    const sizes = [1, 2].map(v => rockPrim(variantSpec('boulder', v)).radius);
    for (const r of sizes) {
      expect(r).not.toBe(base);
      expect(r).toBeGreaterThanOrEqual(base * 0.8);
      expect(r).toBeLessThanOrEqual(base * 1.2);
    }
    expect(new Set([base, ...sizes]).size).toBe(3);   // three distinct native sizes
  });

  it('the size factor is deterministic per seed and stays in [0.8, 1.2]', () => {
    for (let s = 1; s < 200; s++) {
      const f = rockSizeFactor(s);
      expect(rockSizeFactor(s)).toBe(f);
      expect(f).toBeGreaterThanOrEqual(0.8);
      expect(f).toBeLessThanOrEqual(1.2);
    }
  });
});

describe('bare-crown variant (alpine deciduous)', () => {
  it('drops the leaves and keeps the skeleton (same limb count, from the variant-0 seed)', () => {
    const leafy = floraPrim(variantSpec('english-oak', 0));
    const bare = floraPrim(variantSpec('english-oak', FLORA_BARE_VARIANT));

    expect(leafy.leaves.length).toBeGreaterThan(0);
    expect(bare.leaves).toHaveLength(0);                       // leaves dropped
    expect(bare.limbs).toHaveLength(leafy.limbs.length);       // same skeleton, not a stump
  });

  it('extends the TERMINAL limbs (fine winter twigs) and leaves interior limbs alone', () => {
    const leafy = floraPrim(variantSpec('english-oak', 0));
    const bare = floraPrim(variantSpec('english-oak', FLORA_BARE_VARIANT));

    const len = (l: { a: number[]; b: number[] }) => Math.hypot(l.b[0] - l.a[0], l.b[1] - l.a[1], l.b[2] - l.a[2]);
    let extended = 0, unchanged = 0;
    for (let i = 0; i < leafy.limbs.length; i++) {
      const ratio = len(bare.limbs[i]) / len(leafy.limbs[i]);
      if (ratio > 1.001) { extended++; expect(ratio).toBeCloseTo(1.22, 2); } else { unchanged++; }
      expect(bare.limbs[i].a).toEqual(leafy.limbs[i].a);       // every limb keeps its ROOT
    }
    expect(extended).toBeGreaterThan(0);    // the tips grew
    expect(unchanged).toBeGreaterThan(0);   // the trunk/interior did not
  });

  it('is deterministic, and composes into a non-empty sprite', async () => {
    expect(canonicalJson(variantSpec('english-oak', FLORA_BARE_VARIANT)))
      .toBe(canonicalJson(variantSpec('english-oak', FLORA_BARE_VARIANT)));
    const r = await composeStructure(variantSpec('english-oak', FLORA_BARE_VARIANT));
    expect(r.bbox.w).toBeGreaterThan(0);
    expect(r.bbox.h).toBeGreaterThan(0);
  });

  it('a rock kind has no branch_plant part, so the bare slot composes as variant 0 (harmless)', () => {
    expect(canonicalJson(variantSpec('boulder', FLORA_BARE_VARIANT)))
      .toBe(canonicalJson(variantSpec('boulder', 0)));
  });
});
