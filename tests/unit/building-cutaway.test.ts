// @vitest-environment node
// Interior epic I-1: a `cutaway` body renders roof-off with an exposed floor — the geometry
// the interior reveal (I-2) will swap in on focus. Verifiable as a sprite; no game-render change.
import { describe, it, expect } from 'vitest';
import { synthesizeBlueprint } from '@/blueprint/presets';
import { toGeometry } from '@/blueprint/compile/to-geometry';
import { composeStructure } from '@/assetgen/compose';

describe('building cutaway (interior I-1)', () => {
  it('a cutaway body differs from the closed building (roof removed, floor exposed)', async () => {
    const closed = await composeStructure(toGeometry(synthesizeBlueprint('cottage', [], 1)!));
    const cut = await composeStructure(
      toGeometry(synthesizeBlueprint('cottage', [{ parts: { body: { type: 'body', params: { cutaway: true } } } }], 1)!),
    );
    // Removing the roof changes the silhouette + the rendered bytes; it must not crash.
    expect(cut.size).toBeGreaterThan(0);
    expect(cut.grey).not.toEqual(closed.grey);
  });

  it('cutaway false (default) leaves the building prim on the original closed path', () => {
    const g = toGeometry(synthesizeBlueprint('cottage', [{ parts: { body: { type: 'body', params: { cutaway: false } } } }], 1)!);
    const bld = g.parts.find((p) => p.prim === 'building') as Extract<typeof g.parts[number], { prim: 'building' }>;
    expect(bld?.cutaway).toBeUndefined(); // false ⇒ omitted ⇒ roof drawn as normal (no render change)
  });
});
