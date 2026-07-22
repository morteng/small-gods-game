/**
 * P2 living-population — building CAPACITY derivation (pure, catalogue-driven).
 * Every placed preset resolves to the intended CapacityClass with ZERO
 * per-building authoring; sizeBays scales a manor above a cottage with no
 * manor-specific row.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { loadDefaultPacks } from '@/catalogue';
import { catalogue } from '@/catalogue/pack';
import type { BuildingTypeFields } from '@/catalogue/types';
import {
  resolveCapacityClass, resolveBuildingDraw, capacityProfileFor,
  type CapacityClass,
} from '@/sim/population/building-capacity';
import type { BuildingInstance } from '@/core/types';

beforeAll(() => loadDefaultPacks());

function klass(kind: string, civic?: string): CapacityClass | null {
  return resolveCapacityClass(kind, catalogue.get<BuildingTypeFields>('buildingType', kind)?.fields, civic);
}
function inst(templateId: string, id = 't'): BuildingInstance {
  return { id, templateId, tileX: 4, tileY: 4, poiId: 'village', state: 'intact' };
}

describe('resolveCapacityClass', () => {
  it('classifies dwellings', () => {
    for (const k of ['cottage', 'townhouse', 'longhouse', 'yurt', 'manor', 'fisherman_hut']) {
      expect(klass(k), k).toBe('dwelling');
    }
  });
  it('classifies workshops', () => {
    for (const k of ['smithy', 'bakehouse', 'brewhouse', 'watermill']) expect(klass(k), k).toBe('workshop');
  });
  it('classifies worship', () => {
    for (const k of ['temple_small', 'shrine', 'parish-church']) expect(klass(k), k).toBe('worship');
  });
  it('classifies markets', () => {
    for (const k of ['market_stall', 'dock']) expect(klass(k), k).toBe('market');
  });
  it('classifies hospitality', () => {
    for (const k of ['tavern', 'inn']) expect(klass(k), k).toBe('hospitality');
  });
  it('classifies martial', () => {
    for (const k of ['castle_keep', 'tower', 'guard_post']) expect(klass(k), k).toBe('martial');
  });
  it('classifies farmsteads (barns + stables)', () => {
    for (const k of ['farm_barn', 'stable']) expect(klass(k), k).toBe('farmstead');
  });
  it('civic well houses nobody but draws; graveyard/green house nobody', () => {
    expect(klass('well', 'well')).toBe('civic-well');
    expect(klass('anything', 'graveyard')).toBeNull();
    expect(klass('anything', 'green')).toBeNull();
  });
  it('unknown preset with no catalogue fields defaults to dwelling', () => {
    expect(resolveCapacityClass('mystery-hut')).toBe('dwelling');
  });
});

describe('resolveBuildingDraw', () => {
  it('scales manor residents above cottage via sizeBays, no per-building row', () => {
    const cottage = resolveBuildingDraw(inst('cottage', 'c'))!;
    const manor = resolveBuildingDraw(inst('manor', 'm'))!;
    expect(cottage.klass).toBe('dwelling');
    expect(manor.klass).toBe('dwelling');
    expect(manor.residents).toBeGreaterThan(cottage.residents);
  });
  it('carries a resolvable door tile + poi + kind', () => {
    const d = resolveBuildingDraw(inst('cottage', 'c'))!;
    // cottage has a legacy template with doorCell (1,2) at tile (4,4)
    expect(d).toMatchObject({ buildingId: 'c', poiId: 'village', kind: 'cottage', doorX: 5, doorY: 6 });
  });
  it('returns null for a building with no poiId', () => {
    expect(resolveBuildingDraw({ id: 'x', templateId: 'cottage', tileX: 0, tileY: 0, state: 'intact' })).toBeNull();
  });
  it('a market stall houses nobody; a dwelling houses several', () => {
    expect(capacityProfileFor('market_stall')!.residents).toBe(0);
    expect(capacityProfileFor('cottage')!.residents).toBeGreaterThan(0);
  });
});
