// tests/unit/blueprint-golden-regression.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { synthesizeBlueprint } from '@/blueprint/presets';
import { toGeometry } from '@/blueprint/compile/to-geometry';
import { ensureBuildingTypesRegistered } from '@/blueprint/register-buildings';
import { DOOR_HEIGHT_UNITS } from '@/render/scale-contract';

beforeAll(() => ensureBuildingTypesRegistered());

describe('blueprint golden regression', () => {
  it('cottage (rect) → one building prim, 2x2 wing, thatch/plaster, main door south', () => {
    const spec = toGeometry(synthesizeBlueprint('cottage')!);
    const p = spec.parts[0];
    expect(p.prim).toBe('building');
    if (p.prim === 'building') {
      expect(p.wings).toEqual([{ x: 0, y: 0, w: 2, h: 2, storeys: 1, roof: 'gable' }]);
      expect(p.roofMat).toBe('thatch');
      expect(p.wallMat).toBe('plaster');
      expect(p.features?.doors?.[0]).toMatchObject({ face: 'south', main: true });
    }
  });

  it('yurt (round) → cylinder + dome', () => {
    const spec = toGeometry(synthesizeBlueprint('yurt')!);
    expect(spec.parts.map(p => p.prim)).toEqual(['cylinder', 'ellipsoid']);
  });

  it('castle_keep (stepped) → multiple stacked boxes', () => {
    const spec = toGeometry(synthesizeBlueprint('castle_keep')!);
    expect(spec.parts.every(p => p.prim === 'box')).toBe(true);
    expect(spec.parts.length).toBeGreaterThanOrEqual(2);
  });

  it('every preset main door is sized to the scale contract (height ≈ DOOR_HEIGHT_UNITS, ≤1.4×)', () => {
    for (const name of ['cottage', 'tavern', 'temple_small', 'longhouse']) {
      const spec = toGeometry(synthesizeBlueprint(name)!);
      const b = spec.parts.find(p => p.prim === 'building');
      const door = b && b.prim === 'building' ? b.features?.doors?.[0] : undefined;
      expect(door, name).toBeDefined();
      expect(door!.height!, name).toBeGreaterThanOrEqual(DOOR_HEIGHT_UNITS);
      expect(door!.height!, name).toBeLessThanOrEqual(DOOR_HEIGHT_UNITS * 1.4);
    }
  });
});
