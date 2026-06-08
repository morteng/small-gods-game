// tests/unit/blueprint-to-brief.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { toBrief } from '@/blueprint/compile/to-brief';
import { resolveBlueprint } from '@/blueprint/resolve';
import { ensureBuildingTypesRegistered } from '@/blueprint/register-buildings';
import { BLUEPRINT_VERSION, type Blueprint } from '@/blueprint/types';

beforeAll(() => ensureBuildingTypesRegistered());

const cottage: Blueprint = {
  version: BLUEPRINT_VERSION, class: 'building', preset: 'cottage', category: 'residential', era: 'medieval',
  footprint: { w: 3, h: 3 }, materials: { walls: 'wattle', roof: 'thatch' },
  parts: { body: { type: 'body', size: { w: 2, h: 2 }, params: { plan: 'rect', levels: 1, roof: 'gable' }, features: { door: { type: 'door', face: 'south', params: { main: true } } } } },
};

describe('toBrief', () => {
  it('produces a building brief with subject, traits, materials, and door face', () => {
    const brief = toBrief(resolveBlueprint([cottage], 0), 7);
    expect(brief.kind).toBe('building');
    expect(brief.subject).toBe('cottage');
    expect(brief.traits).toContain('human-height door');
    expect(brief.traits.some(t => /single-storey/.test(t))).toBe(true);
    expect(brief.materials.find(m => m.part === 'walls')?.material).toBe('wattle');
    expect(brief.door!.face).toBe('s');
    expect(brief.footprint).toEqual({ w: 2, h: 2 });   // structure bbox
  });
});
