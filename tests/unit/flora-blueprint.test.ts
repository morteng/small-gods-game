// @vitest-environment node
// Integration: the new branching-flora / rock presets resolve through the
// Blueprint pipeline and compose into a non-empty sprite (same path as buildings).
import { describe, it, expect } from 'vitest';
import { synthesizeBlueprint } from '@/blueprint/presets';
import { toGeometry } from '@/blueprint/compile/to-geometry';
import { composeStructure } from '@/assetgen/compose';

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
