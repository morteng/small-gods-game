import { describe, it, expect, beforeAll } from 'vitest';
import { blueprintEntity, blueprintOf } from '@/blueprint/entity';
import { synthesizeBlueprint } from '@/blueprint/presets';
import { ensureBuildingTypesRegistered } from '@/blueprint/register-buildings';

beforeAll(() => ensureBuildingTypesRegistered());

describe('blueprintEntity', () => {
  it('builds a building entity carrying the resolved blueprint + collision + anchors', () => {
    const rb = synthesizeBlueprint('cottage')!;
    const e = blueprintEntity('b1', rb, 5, 6);
    expect(e.kind).toBe('cottage');
    expect(e.tags).toContain('building');
    expect(e.properties.footprint).toEqual({ w: 3, h: 3 });
    const stored = blueprintOf(e)!;
    expect(stored.collision.blocked.length).toBeGreaterThan(0);
    expect(stored.anchors.some(a => a.kind === 'door')).toBe(true);
  });
});
