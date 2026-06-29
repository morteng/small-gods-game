// @vitest-environment node
// Interior epic I-1: a `cutaway` body renders roof-off with an exposed floor — the geometry
// the interior reveal (I-2) will swap in on focus. Verifiable as a sprite; no game-render change.
import { describe, it, expect } from 'vitest';
import { synthesizeBlueprint } from '@/blueprint/presets';
import { toGeometry } from '@/blueprint/compile/to-geometry';
import { composeStructure } from '@/assetgen/compose';
import { cutawayOf } from '@/blueprint/cutaway';

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

describe('cutawayOf (interior I-2 view derivation)', () => {
  it('sets cutaway:true on body parts and yields a DISTINCT JSON identity (its own art key)', () => {
    const rb = synthesizeBlueprint('cottage', [], 1)!;
    const cut = cutawayOf(rb);
    expect(cut).not.toBe(rb);                                   // cloned, not mutated
    expect(JSON.stringify(cut)).not.toEqual(JSON.stringify(rb)); // distinct cache key
    const body = cut.parts.find((p) => p.type === 'body')!;
    expect(body.params.cutaway).toBe(true);
    // The original is untouched (no shared-mutation bug).
    expect(rb.parts.find((p) => p.type === 'body')!.params.cutaway).not.toBe(true);
  });

  it('compiles its cutaway body straight through to the I-1 cutaway geometry', () => {
    const cut = cutawayOf(synthesizeBlueprint('cottage', [], 1)!);
    const g = toGeometry(cut);
    const bld = g.parts.find((p) => p.prim === 'building') as Extract<typeof g.parts[number], { prim: 'building' }>;
    expect(bld?.cutaway).toBe(true);
  });

  it('is a no-op (same object) when already cut away', () => {
    const cut = cutawayOf(synthesizeBlueprint('cottage', [], 1)!);
    expect(cutawayOf(cut)).toBe(cut);
  });
});
