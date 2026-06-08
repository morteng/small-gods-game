// tests/unit/blueprint-resolve.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mergePatches, resolveBlueprint } from '@/blueprint/resolve';
import {
  registerPartType, registerFeatureType, _resetRegistryForTest,
  type PartType, type FeatureType,
} from '@/blueprint/registry';
import { BLUEPRINT_VERSION, type Blueprint, type BlueprintPatch } from '@/blueprint/types';

const body: PartType = {
  type: 'body',
  paramSchema: { levels: { kind: 'number', min: 1, max: 8, default: 1 } },
  resolve: (p) => ({ params: { levels: (p.params?.levels as number) ?? 1 } }),
  toPrims: () => [], toCollision: () => [], toAnchors: () => [], toBrief: () => 'body',
};
const door: FeatureType = {
  type: 'door',
  paramSchema: { height: { kind: 'number', default: 0.85 } },
  resolve: (f) => ({ params: { height: (f.params?.height as number) ?? 0.85 } }),
  toBrief: () => 'door',
};

const base: Blueprint = {
  version: BLUEPRINT_VERSION, class: 'building', footprint: { w: 3, h: 3 },
  materials: { walls: 'timber' },
  parts: { body: { type: 'body', size: { w: 2, h: 2 }, features: { d: { type: 'door', face: 'south' } } } },
};

describe('mergePatches', () => {
  it('last-wins on scalars', () => {
    const m = mergePatches([base, { era: 'classical' }]);
    expect(m.era).toBe('classical');
  });
  it('tweaks one part param by id without dropping siblings', () => {
    const m = mergePatches([base, { parts: { body: { type: 'body', params: { levels: 3 } } } }]);
    expect(m.parts.body.params?.levels).toBe(3);
    expect(m.parts.body.size).toEqual({ w: 2, h: 2 });  // preserved
  });
  it('adds a new part', () => {
    const m = mergePatches([base, { parts: { chimney: { type: 'chimney' } } }]);
    expect(Object.keys(m.parts).sort()).toEqual(['body', 'chimney']);
  });
  it('deletes a part when a patch sets it to null', () => {
    const m = mergePatches([base, { parts: { body: null } }]);
    expect(m.parts.body).toBeUndefined();
  });
});

describe('resolveBlueprint', () => {
  beforeEach(() => { _resetRegistryForTest(); registerPartType(body); registerFeatureType(door); });
  it('produces ordered resolved parts with filled params + resolved features', () => {
    const rb = resolveBlueprint([base], 0);
    expect(rb.parts).toHaveLength(1);
    expect(rb.parts[0].id).toBe('body');
    expect(rb.parts[0].params.levels).toBe(1);
    expect(rb.parts[0].features[0].type).toBe('door');
    expect(rb.parts[0].features[0].params.height).toBe(0.85);
  });
  it('defaults at to (0,0) and carries footprint + materials', () => {
    const rb = resolveBlueprint([base], 0);
    expect(rb.parts[0].at).toEqual({ x: 0, y: 0 });
    expect(rb.footprint).toEqual({ w: 3, h: 3 });
    expect(rb.materials.walls).toBe('timber');
  });
});
