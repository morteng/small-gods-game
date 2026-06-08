// tests/unit/blueprint-to-geometry.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { toGeometry } from '@/blueprint/compile/to-geometry';
import { resolveBlueprint } from '@/blueprint/resolve';
import { ensureBuildingTypesRegistered } from '@/blueprint/register-buildings';
import { BLUEPRINT_VERSION, type Blueprint } from '@/blueprint/types';

beforeAll(() => ensureBuildingTypesRegistered());

const cottage: Blueprint = {
  version: BLUEPRINT_VERSION, class: 'building', footprint: { w: 3, h: 3 },
  materials: { walls: 'wattle', roof: 'thatch' },
  parts: {
    body: {
      type: 'body', size: { w: 2, h: 2 }, params: { plan: 'rect', levels: 1, roof: 'gable' },
      features: { door: { type: 'door', face: 'south', params: { main: true } }, smoke: { type: 'vent', params: { kind: 'chimney' } } },
    },
  },
};

describe('toGeometry', () => {
  it('rect body → one building prim with the wing, door, and vent folded in', () => {
    const spec = toGeometry(resolveBlueprint([cottage], 0));
    expect(spec.parts).toHaveLength(1);
    const p = spec.parts[0];
    expect(p.prim).toBe('building');
    if (p.prim === 'building') {
      expect(p.wings).toEqual([{ x: 0, y: 0, w: 2, h: 2, storeys: 1, roof: 'gable' }]);
      expect(p.wallMat).toBe('plaster');   // wattle → plaster
      expect(p.roofMat).toBe('thatch');
      expect(p.features?.doors?.[0]).toMatchObject({ face: 'south', main: true });
      expect(p.features?.vents?.[0]).toMatchObject({ wing: 0, kind: 'chimney' });
    }
  });

  it('round body → cylinder + cap, no building prim', () => {
    const yurt: Blueprint = {
      version: BLUEPRINT_VERSION, class: 'building', footprint: { w: 2, h: 2 },
      materials: { walls: 'hide', roof: 'hide' },
      parts: { body: { type: 'body', size: { w: 2, h: 2 }, params: { plan: 'round', levels: 1, roof: 'domed' } } },
    };
    const spec = toGeometry(resolveBlueprint([yurt], 0));
    expect(spec.parts.map(p => p.prim)).toEqual(['cylinder', 'ellipsoid']);
  });

  it('body + wing → wings merged into one building prim', () => {
    const ell: Blueprint = {
      version: BLUEPRINT_VERSION, class: 'building', footprint: { w: 4, h: 4 },
      materials: { walls: 'stone', roof: 'tile' },
      parts: {
        body: { type: 'body', size: { w: 4, h: 2 }, params: { plan: 'rect', levels: 1, roof: 'gable' } },
        ell: { type: 'wing', at: { x: 0, y: 2 }, size: { w: 2, h: 2 }, params: { levels: 1, roof: 'gable' } },
      },
    };
    const spec = toGeometry(resolveBlueprint([ell], 0));
    expect(spec.parts).toHaveLength(1);
    if (spec.parts[0].prim === 'building') expect(spec.parts[0].wings).toHaveLength(2);
  });
});
