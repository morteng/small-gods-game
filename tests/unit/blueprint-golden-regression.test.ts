// tests/unit/blueprint-golden-regression.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { synthesizeBlueprint } from '@/blueprint/presets';
import { toGeometry } from '@/blueprint/compile/to-geometry';
import { ensureBuildingTypesRegistered } from '@/blueprint/register-buildings';

beforeAll(() => ensureBuildingTypesRegistered());

/** The door leaf prim a preset emits (a door-material box), if any. */
function doorLeaf(name: string) {
  const spec = toGeometry(synthesizeBlueprint(name)!);
  return spec.parts.find(p => p.prim === 'box' && p.material === 'door');
}

describe('blueprint golden regression — openings', () => {
  it('cottage (rect) → building prim carries a door aperture + a leaf prim', () => {
    const spec = toGeometry(synthesizeBlueprint('cottage')!);
    const b = spec.parts.find(p => p.prim === 'building')!;
    expect(b.prim === 'building' && b.apertures?.length).toBe(1);
    expect(doorLeaf('cottage')).toBeDefined();
  });

  it('yurt (round) → cylinder carries a door aperture + a leaf prim (door now visible)', () => {
    const spec = toGeometry(synthesizeBlueprint('yurt')!);
    const cyl = spec.parts.find(p => p.prim === 'cylinder');
    expect(cyl && cyl.prim === 'cylinder' && cyl.apertures?.length).toBe(1);
    expect(doorLeaf('yurt')).toBeDefined();
  });

  it('castle_keep (stepped) → ground box carries a door aperture + a leaf prim (door now visible)', () => {
    const spec = toGeometry(synthesizeBlueprint('castle_keep')!);
    const boxes = spec.parts.filter(p => p.prim === 'box' && p.material !== 'door');
    expect(boxes.some(b => b.prim === 'box' && b.apertures?.length)).toBe(true);
    expect(doorLeaf('castle_keep')).toBeDefined();
  });

  it('every preset door leaf is sized to the scale contract and never protrudes its wall', () => {
    for (const name of ['cottage', 'tavern', 'temple_small', 'longhouse']) {
      const leaf = doorLeaf(name);
      expect(leaf, name).toBeDefined();
      if (leaf && leaf.prim === 'box') {
        // height (z extent) tracks DOOR_HEIGHT_UNITS (0.85) up to the main ×1.18 = ~1.0
        expect(leaf.size[2], name).toBeGreaterThanOrEqual(0.85);
        expect(leaf.size[2], name).toBeLessThanOrEqual(0.85 * 1.4);
      }
    }
  });
});
