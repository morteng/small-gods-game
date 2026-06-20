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
  it('leaves spec.size unset so buildings render at the fixed metric scale (not fit-to-box)', () => {
    const spec = toGeometry(resolveBlueprint([cottage], 0));
    expect(spec.size).toBeUndefined();
  });

  it('rect body → one building prim; door becomes a carved aperture + filler leaf', () => {
    const spec = toGeometry(resolveBlueprint([cottage], 0));
    const building = spec.parts.find(p => p.prim === 'building')!;
    expect(building.prim).toBe('building');
    if (building.prim === 'building') {
      expect(building.wings).toEqual([{ x: 0, y: 0, w: 2, h: 2, storeys: 1, storeyHeight: 1.35, roof: 'gable' }]);
      expect(building.wallMat).toBe('plaster');
      expect(building.roofMat).toBe('thatch');
      expect(building.apertures?.length).toBe(1);                 // door carved the wall
      expect(building.features?.vents?.[0]).toMatchObject({ wing: 0, kind: 'chimney' });
    }
    const leaf = spec.parts.find(p => p.prim === 'box' && p.material === 'door');
    expect(leaf).toBeDefined();
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

  it('round body with a door → cylinder carries the aperture + a filler leaf prim', () => {
    const yurt: Blueprint = {
      version: BLUEPRINT_VERSION, class: 'building', footprint: { w: 2, h: 2 },
      materials: { walls: 'hide', roof: 'hide' },
      parts: { body: { type: 'body', size: { w: 2, h: 2 }, params: { plan: 'round', levels: 1, roof: 'domed' },
        features: { door: { type: 'door', face: 'south' } } } },
    };
    const spec = toGeometry(resolveBlueprint([yurt], 0));
    const cyl = spec.parts.find(p => p.prim === 'cylinder')!;
    expect(cyl.prim === 'cylinder' && cyl.apertures?.length).toBe(1);
    expect(spec.parts.some(p => p.prim === 'box' && p.material === 'door')).toBe(true);
  });

  it('perStorey windows RANK up the storeys; doors stay on the ground floor', () => {
    const make = (levels: number, perStorey: boolean): Blueprint => ({
      version: BLUEPRINT_VERSION, class: 'building', footprint: { w: 3, h: 3 },
      materials: { walls: 'stone', roof: 'tile' },
      parts: { body: {
        type: 'body', size: { w: 3, h: 2 }, params: { plan: 'rect', levels, storeyM: 3, roof: 'gable' },
        features: {
          door: { type: 'door', face: 'south', params: {} },
          win: { type: 'window', face: 'south', params: { t: 0.5, sill: 0.4, height: 0.6, perStorey } },
        },
      } },
    });
    const apertures = (bp: Blueprint) => {
      const b = toGeometry(resolveBlueprint([bp], 0)).parts.find(p => p.prim === 'building')!;
      return b.prim === 'building' ? b.apertures!.length : -1;
    };
    expect(apertures(make(1, true))).toBe(2);   // door + 1 window (single storey)
    expect(apertures(make(3, true))).toBe(4);   // door + 1 window × 3 storeys
    expect(apertures(make(3, false))).toBe(2);  // not ranked → door + 1 ground window only
  });

  it('a window taller than the wall is clamped under the eave (geometry self-check)', () => {
    const tall: Blueprint = {
      version: BLUEPRINT_VERSION, class: 'building', footprint: { w: 3, h: 3 },
      materials: { walls: 'stone', roof: 'gable' as never },
      parts: { body: {
        type: 'body', size: { w: 3, h: 2 }, params: { plan: 'rect', levels: 1, storeyM: 3, roof: 'gable' },
        // wall eave ≈ 1.5 tiles; sill 0.3 + height 3 would shoot through the roof.
        features: { win: { type: 'window', face: 'south', params: { t: 0.5, sill: 0.3, height: 3 } } },
      } },
    };
    const leaf = toGeometry(resolveBlueprint([tall], 0)).parts.find(p => p.prim === 'box' && p.material === 'glass');
    // pane height (z extent) was clamped to fit beneath the eave (well under the authored 3).
    expect(leaf && leaf.prim === 'box' ? leaf.size[2] : 99).toBeLessThan(1.5);
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
