// tests/unit/blueprint-to-collision.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { toCollision } from '@/blueprint/compile/to-collision';
import { resolveBlueprint } from '@/blueprint/resolve';
import { ensureBuildingTypesRegistered } from '@/blueprint/register-buildings';
import { BLUEPRINT_VERSION, type Blueprint } from '@/blueprint/types';

beforeAll(() => ensureBuildingTypesRegistered());

const cottage: Blueprint = {
  version: BLUEPRINT_VERSION, class: 'building', footprint: { w: 3, h: 3 },
  materials: { walls: 'wattle', roof: 'thatch' },
  parts: {
    body: {
      type: 'body', at: { x: 0, y: 0 }, size: { w: 2, h: 2 }, params: { plan: 'rect', levels: 1, roof: 'gable' },
      features: { door: { type: 'door', face: 'south', params: { main: true } } },
    },
  },
};

describe('toCollision', () => {
  it('blocks the 2x2 structure, leaves the rest of the 3x3 plot as lawn', () => {
    const c = toCollision(resolveBlueprint([cottage], 0));
    expect(c.footprint).toEqual({ w: 3, h: 3 });
    expect(new Set(c.blocked)).toEqual(new Set(['0,0', '1,0', '0,1', '1,1']));
  });
  it('marks a door cell on the south edge of the body', () => {
    const c = toCollision(resolveBlueprint([cottage], 0));
    // south edge of a 2-tall body at y∈{0,1} → door cell at y=1
    expect(c.doorCells.some(k => k.endsWith(',1'))).toBe(true);
  });
});
