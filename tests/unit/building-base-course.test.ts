// @vitest-environment node
// L3b cellars: a body with a `baseCourse` param renders a stone undercroft band at the wall
// foot (the rest in the wall material), via a Manifold split in buildingFacets.
import { describe, it, expect } from 'vitest';
import { synthesizeBlueprint } from '@/blueprint/presets';
import { toGeometry } from '@/blueprint/compile/to-geometry';
import { composeStructure } from '@/assetgen/compose';

describe('building base course (L3b undercroft)', () => {
  it('threads baseCourse from the body param onto the building prim', () => {
    const rb = synthesizeBlueprint('townhouse', [{ parts: { body: { type: 'body', params: { baseCourse: 0.7 } } } }], 1)!;
    const g = toGeometry(rb);
    const bld = g.parts.find((p) => p.prim === 'building') as Extract<typeof g.parts[number], { prim: 'building' }>;
    expect(bld?.baseCourse).toBe(0.7);
  });

  it('a stone base course changes the rendered fabric vs no undercroft (timber-walled townhouse)', async () => {
    const withBase = await composeStructure(
      toGeometry(synthesizeBlueprint('townhouse', [{ parts: { body: { type: 'body', params: { baseCourse: 0.7 } } } }], 1)!),
    );
    const plain = await composeStructure(toGeometry(synthesizeBlueprint('townhouse', [], 1)!));
    // The undercroft repaints the lower wall band stone — the material + albedo channels must
    // differ from the all-timber wall, but the silhouette (size) is unchanged.
    expect(withBase.size).toBe(plain.size);
    let matDiff = 0;
    for (let i = 0; i < Math.min(withBase.material.length, plain.material.length); i++) {
      if (withBase.material[i] !== plain.material[i]) matDiff++;
    }
    expect(matDiff).toBeGreaterThan(0);
  });

  it('baseCourse 0 (default) leaves the building prim without a base course', () => {
    const g = toGeometry(synthesizeBlueprint('townhouse', [{ parts: { body: { type: 'body', params: { baseCourse: 0 } } } }], 1)!);
    const bld = g.parts.find((p) => p.prim === 'building') as Extract<typeof g.parts[number], { prim: 'building' }>;
    expect(bld?.baseCourse).toBeUndefined(); // 0 ⇒ omitted ⇒ original single-material path
  });
});
