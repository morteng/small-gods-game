// tests/unit/blueprint-opening.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { isOpening } from '@/blueprint/features/opening';
import type { FeatureType } from '@/blueprint/registry';
import { resolveBlueprint } from '@/blueprint/resolve';
import { BLUEPRINT_VERSION, type Blueprint } from '@/blueprint/types';
import { getFeatureType } from '@/blueprint/registry';
import { ensureBuildingTypesRegistered } from '@/blueprint/register-buildings';

beforeAll(() => ensureBuildingTypesRegistered());

const plain: FeatureType = {
  type: 'plain', paramSchema: {}, resolve: () => ({ params: {} }), toBrief: () => 'plain',
};
const opening: FeatureType = {
  ...plain, type: 'opening', threshold: true,
  aperture: () => ({ face: 'south', t: 0.5, sill: 0, halfW: 0.2, height: 0.85, depth: 0.3 }),
  filler: () => [],
};

describe('opening contract', () => {
  it('isOpening is true only when a kind declares an aperture hook', () => {
    expect(isOpening(opening)).toBe(true);
    expect(isOpening(plain)).toBe(false);
    expect(isOpening(undefined)).toBe(false);
  });
});

describe('door opening hooks', () => {
  const bp: Blueprint = {
    version: BLUEPRINT_VERSION, class: 'building', footprint: { w: 2, h: 2 },
    materials: { walls: 'stone', roof: 'tile' },
    parts: { body: { type: 'body', size: { w: 2, h: 2 }, params: { plan: 'rect', roof: 'gable' },
      features: { door: { type: 'door', face: 'south', params: { main: true } } } } },
  };

  it('aperture sits on the resolved door face with contract-sized height', () => {
    const rb = resolveBlueprint([bp], 0);
    const part = rb.parts[0];
    const door = part.features.find(f => f.type === 'door')!;
    const ap = getFeatureType('door')!.aperture!(door, part, { materials: rb.materials, footprint: rb.footprint });
    expect(ap.face).toBe('south');
    expect(ap.height).toBeGreaterThanOrEqual(0.85);   // DOOR_HEIGHT_UNITS
  });

  it('filler is a door-material leaf prim', () => {
    const rb = resolveBlueprint([bp], 0);
    const part = rb.parts[0];
    const door = part.features.find(f => f.type === 'door')!;
    const prims = getFeatureType('door')!.filler!(door, part, { materials: rb.materials, footprint: rb.footprint });
    expect(prims).toHaveLength(1);
    expect(prims[0]).toMatchObject({ prim: 'box', material: 'door' });
  });

  it('resolves rich semantics with defaults', () => {
    const rb = resolveBlueprint([bp], 0);
    const door = rb.parts[0].features.find(f => f.type === 'door')!;
    expect(door.params).toMatchObject({ hinge: 'left', swing: 'in', locked: false, open: 0, handle: true });
  });
});

describe('window opening hooks', () => {
  const bp: Blueprint = {
    version: BLUEPRINT_VERSION, class: 'building', footprint: { w: 3, h: 2 },
    materials: { walls: 'stone', roof: 'tile' },
    parts: { body: { type: 'body', size: { w: 3, h: 2 }, params: { plan: 'rect', roof: 'gable' },
      features: { win: { type: 'window', face: 'south', params: { style: 'arched' } } } } },
  };

  it('window aperture is raised (sill > 0) and not a threshold', () => {
    const rb = resolveBlueprint([bp], 0);
    const part = rb.parts[0];
    const win = part.features.find(f => f.type === 'window')!;
    const ft = getFeatureType('window')!;
    const ap = ft.aperture!(win, part, { materials: rb.materials, footprint: rb.footprint });
    expect(ap.sill).toBeGreaterThan(0);
    expect(ft.threshold).toBe(false);
  });
});
