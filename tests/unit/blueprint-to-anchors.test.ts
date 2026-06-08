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

const twoDoors: Blueprint = {
  version: BLUEPRINT_VERSION, class: 'building', footprint: { w: 3, h: 3 },
  materials: { walls: 'stone', roof: 'tile' },
  parts: { body: { type: 'body', size: { w: 3, h: 3 }, params: { plan: 'rect', roof: 'gable' },
    features: {
      front: { type: 'door', face: 'south', params: { main: true } },
      side: { type: 'door', face: 'east' },
      win: { type: 'window', face: 'north' },
    } } },
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

  it('emits one door anchor per threshold opening (windows excluded)', () => {
    const anchors = toAnchors(resolveBlueprint([twoDoors], 0), 10, 20);
    const doors = anchors.filter(a => a.kind === 'door');
    expect(doors).toHaveLength(2);
    expect(doors.some(a => a.main)).toBe(true);
    // windows are not AnchorKind — verify only door anchors are present
    expect(anchors.every(a => a.kind === 'door')).toBe(true);
  });
});
