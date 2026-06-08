// tests/unit/blueprint-to-anchors.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { toAnchors } from '@/blueprint/compile/to-anchors';
import { resolveBlueprint } from '@/blueprint/resolve';
import { ensureBuildingTypesRegistered } from '@/blueprint/register-buildings';
import { BLUEPRINT_VERSION, type Blueprint } from '@/blueprint/types';

beforeAll(() => ensureBuildingTypesRegistered());

const cottage: Blueprint = {
  version: BLUEPRINT_VERSION, class: 'building', footprint: { w: 3, h: 3 },
  materials: { walls: 'wattle', roof: 'thatch' },
  parts: { body: { type: 'body', size: { w: 2, h: 2 }, params: { plan: 'rect', levels: 1, roof: 'gable' }, features: { door: { type: 'door', face: 'south', params: { main: true } } } } },
};

describe('toAnchors', () => {
  it('emits a south-facing main door anchor at world origin offset', () => {
    const anchors = toAnchors(resolveBlueprint([cottage], 0), 10, 20);
    const door = anchors.find(a => a.kind === 'door');
    expect(door).toBeDefined();
    expect(door!.main).toBe(true);
    expect(door!.facing).toEqual([0, 1]);     // south
    expect(door!.y).toBeGreaterThan(20);       // offset into the world
  });
});
