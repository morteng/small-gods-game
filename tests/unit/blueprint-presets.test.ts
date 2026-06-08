// tests/unit/blueprint-presets.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { BUILDING_BLUEPRINTS, synthesizeBlueprint, getBlueprintPreset } from '@/blueprint/presets';
import { ensureBuildingTypesRegistered } from '@/blueprint/register-buildings';
import { toGeometry } from '@/blueprint/compile/to-geometry';

beforeAll(() => ensureBuildingTypesRegistered());

const NAMES = ['cottage','tavern','market_stall','temple_small','farm_barn','tower','castle_keep','dock','shrine','guard_post','yurt','longhouse'];

describe('blueprint presets', () => {
  it('defines all 11+ named presets', () => {
    for (const n of NAMES) expect(getBlueprintPreset(n)).toBeDefined();
  });
  it('every preset resolves + compiles to a non-empty StructureSpec', () => {
    for (const n of NAMES) {
      const rb = synthesizeBlueprint(n)!;
      const spec = toGeometry(rb);
      expect(spec.parts.length, n).toBeGreaterThan(0);
    }
  });
  it('cottage has a 2x2 body on a 3x3 plot and a south door', () => {
    const rb = synthesizeBlueprint('cottage')!;
    const body = rb.parts.find(p => p.type === 'body')!;
    expect(body.size).toEqual({ w: 2, h: 2 });
    expect(rb.footprint).toEqual({ w: 3, h: 3 });
    expect(body.features.find(f => f.type === 'door')?.face).toBe('south');
  });
  it('synthesizeBlueprint applies an override patch (levels bump)', () => {
    const rb = synthesizeBlueprint('cottage', [{ parts: { body: { type: 'body', params: { levels: 2 } } } }])!;
    expect(rb.parts.find(p => p.type === 'body')!.params.levels).toBe(2);
  });
});
