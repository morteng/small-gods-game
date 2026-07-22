/**
 * P2 living-population — settlement DEMAND / apportionment (pure).
 * Occupancy sums to the budget (capped by capacity), never exceeds a building's
 * declared slot, is deterministic + largest-remainder, and reads only the POI's
 * own buildings.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { loadDefaultPacks } from '@/catalogue';
import {
  settlementDraws, apportionOccupancy, planResidents, residentCapacity,
} from '@/sim/population/settlement-demand';
import type { GameMap, BuildingInstance } from '@/core/types';

beforeAll(() => loadDefaultPacks());

function mapWith(buildings: BuildingInstance[]): GameMap {
  return { tiles: [], width: 32, height: 32, villages: [], seed: 1, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings } as unknown as GameMap;
}
function cottages(poiId: string, n: number, offset = 0): BuildingInstance[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `${poiId}_bld_${offset + i}`, templateId: 'cottage',
    tileX: 2 + i, tileY: 2, poiId, state: 'intact' as const,
  }));
}

describe('settlementDraws', () => {
  it('gathers only the POI\'s buildings, sorted by id', () => {
    const map = mapWith([...cottages('village', 3), ...cottages('hamlet', 2, 100)]);
    const draws = settlementDraws(map, 'village');
    expect(draws.map(d => d.buildingId)).toEqual(['village_bld_0', 'village_bld_1', 'village_bld_2']);
    expect(draws.every(d => d.poiId === 'village')).toBe(true);
  });
});

describe('apportionOccupancy', () => {
  it('sums to budget and never exceeds a building cap', () => {
    const draws = settlementDraws(mapWith(cottages('village', 3)), 'village'); // 5 residents each = 15 cap
    const alloc = apportionOccupancy(draws, 9, 'residents');
    const sum = [...alloc.values()].reduce((a, b) => a + b, 0);
    expect(sum).toBe(9);
    for (const d of draws) expect(alloc.get(d.buildingId)!).toBeLessThanOrEqual(d.residents);
  });
  it('caps at total capacity when budget exceeds it', () => {
    const draws = settlementDraws(mapWith(cottages('village', 2)), 'village'); // 10 cap
    const alloc = apportionOccupancy(draws, 999, 'residents');
    expect([...alloc.values()].reduce((a, b) => a + b, 0)).toBe(10);
  });
  it('is deterministic (identical map on repeat)', () => {
    const draws = settlementDraws(mapWith(cottages('village', 4)), 'village');
    const a = apportionOccupancy(draws, 7, 'residents');
    const b = apportionOccupancy(draws, 7, 'residents');
    expect([...a.entries()]).toEqual([...b.entries()]);
  });
});

describe('planResidents + residentCapacity', () => {
  it('fills homes and reports total capacity', () => {
    const draws = settlementDraws(mapWith(cottages('village', 3)), 'village');
    expect(residentCapacity(draws)).toBe(15);
    const plan = planResidents(draws, 8);
    expect(plan.total).toBe(8);
    expect([...plan.byBuilding.values()].reduce((a, b) => a + b, 0)).toBe(8);
  });
  it('non-dwellings are excluded from resident plans', () => {
    const buildings: BuildingInstance[] = [
      ...cottages('village', 1),
      { id: 'village_temple', templateId: 'temple_small', tileX: 8, tileY: 8, poiId: 'village', state: 'intact' },
      { id: 'village_stall', templateId: 'market_stall', tileX: 9, tileY: 9, poiId: 'village', state: 'intact' },
    ];
    const draws = settlementDraws(mapWith(buildings), 'village');
    const plan = planResidents(draws, 5);
    expect(plan.byBuilding.get('village_stall') ?? 0).toBe(0);
    expect(plan.byBuilding.get('village_bld_0')).toBeGreaterThan(0);
  });
});
