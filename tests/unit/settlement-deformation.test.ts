import { describe, it, expect } from 'vitest';
import type { GameMap } from '@/core/types';
import type { SettlementPlan, Lot } from '@/world/settlement-plan';
import { buildSettlementPadDeformations, settlementBuildCount } from '@/world/settlement-deformation';
import { heightAt, DeformationStore } from '@/world/terrain-deformation';

function lot(id: string, ox: number, oy: number, w: number, h: number, built = true): Lot {
  const tiles: { x: number; y: number }[] = [];
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) tiles.push({ x: ox + dx, y: oy + dy });
  return { id, edge: 0, side: [0, 1], frontage: [{ x: ox, y: oy }], depth: h, tiles, buildingId: built ? `b:${id}` : undefined };
}

function mapWith(lots: Lot[]): GameMap {
  const plan = { center: { x: 20, y: 20 }, nodes: [], edges: [], slots: [], lots, wards: [], civics: [], market: [] } as unknown as SettlementPlan;
  return { seed: 99, width: 64, height: 64, settlementPlans: [plan] } as unknown as GameMap;
}

describe('settlement-deformation — gentle building foundation pads', () => {
  it('emits one level pad per BUILT lot, none for unbuilt', () => {
    const map = mapWith([lot('a', 10, 10, 3, 4, true), lot('b', 20, 20, 3, 4, false)]);
    const defs = buildSettlementPadDeformations(map);
    expect(defs.length).toBe(1);
    expect(defs[0].op).toBe('level');
    expect(defs[0].source).toBe('settlement:pad');
  });

  it('the pad is full strength on the footprint and zero well outside it', () => {
    const map = mapWith([lot('a', 10, 10, 3, 4, true)]);
    const [pad] = buildSettlementPadDeformations(map);
    expect(pad.mask(11, 12)).toBe(1);     // inside the footprint
    expect(pad.mask(30, 30)).toBe(0);     // far away
  });

  it('levels the footprint: composed height is ~flat across a built lot on varied terrain', () => {
    const map = mapWith([lot('a', 10, 10, 3, 4, true)]);
    const store = new DeformationStore();
    store.add(...buildSettlementPadDeformations(map));
    const hs = map.settlementPlans![0].lots[0].tiles.map((t) => heightAt(map, store, t.x, t.y));
    const min = Math.min(...hs), max = Math.max(...hs);
    expect(max - min).toBeLessThan(0.05); // metres — the pad flattened the footprint
  });

  it('settlementBuildCount counts only built lots', () => {
    expect(settlementBuildCount(mapWith([lot('a', 10, 10, 3, 4, true), lot('b', 20, 20, 3, 4, false)]))).toBe(1);
    expect(settlementBuildCount({ seed: 1, width: 8, height: 8 } as unknown as GameMap)).toBe(0);
  });
});
