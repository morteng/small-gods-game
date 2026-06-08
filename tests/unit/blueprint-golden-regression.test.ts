// tests/unit/blueprint-golden-regression.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { synthesizeBlueprint } from '@/blueprint/presets';
import { toGeometry } from '@/blueprint/compile/to-geometry';
import { ensureBuildingTypesRegistered } from '@/blueprint/register-buildings';

beforeAll(() => ensureBuildingTypesRegistered());

describe('blueprint golden regression', () => {
  it('cottage (rect) → one building prim, 2x2 wing, thatch/plaster, door carved as aperture', () => {
    const spec = toGeometry(synthesizeBlueprint('cottage')!);
    const p = spec.parts[0];
    expect(p.prim).toBe('building');
    if (p.prim === 'building') {
      expect(p.wings).toEqual([{ x: 0, y: 0, w: 2, h: 2, storeys: 1, roof: 'gable' }]);
      expect(p.roofMat).toBe('thatch');
      expect(p.wallMat).toBe('plaster');
      expect(p.apertures?.length).toBe(1);
    }
  });

  it('yurt (round) → cylinder + dome + door leaf', () => {
    const spec = toGeometry(synthesizeBlueprint('yurt')!);
    const prims = spec.parts.map(p => p.prim);
    expect(prims).toContain('cylinder');
    expect(prims).toContain('ellipsoid');
    // door on a round body becomes a filler leaf (box)
    expect(prims).toContain('box');
  });

  it('castle_keep (stepped) → multiple stacked boxes', () => {
    const spec = toGeometry(synthesizeBlueprint('castle_keep')!);
    expect(spec.parts.every(p => p.prim === 'box')).toBe(true);
    expect(spec.parts.length).toBeGreaterThanOrEqual(2);
  });

  it('every preset main door is sized to the scale contract (leaf height ≈ DOOR_HEIGHT_UNITS, ≤1.4×)', () => {
    for (const name of ['cottage', 'tavern', 'temple_small', 'longhouse']) {
      const spec = toGeometry(synthesizeBlueprint(name)!);
      const leaf = spec.parts.find(p => p.prim === 'box' && p.material === 'door');
      expect(leaf, name).toBeDefined();
      if (leaf && leaf.prim === 'box') {
        expect(leaf.size[2], name).toBeGreaterThanOrEqual(0.85);
        expect(leaf.size[2], name).toBeLessThanOrEqual(0.85 * 1.4);
      }
    }
  });
});
