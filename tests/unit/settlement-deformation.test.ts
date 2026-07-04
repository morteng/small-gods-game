import { describe, it, expect } from 'vitest';
import type { GameMap } from '@/core/types';
import type { SettlementPlan, Lot, CivicSite } from '@/world/settlement-plan';
import { buildSettlementPadDeformations, settlementBuildCount } from '@/world/settlement-deformation';
import { heightAt, DeformationStore } from '@/world/terrain-deformation';
import { heightMetresAt } from '@/world/heightfield';

function lot(id: string, ox: number, oy: number, w: number, h: number, built = true): Lot {
  const tiles: { x: number; y: number }[] = [];
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) tiles.push({ x: ox + dx, y: oy + dy });
  return { id, edge: 0, side: [0, 1], frontage: [{ x: ox, y: oy }], depth: h, tiles, buildingId: built ? `b:${id}` : undefined };
}

function mapWith(lots: Lot[], civics: CivicSite[] = []): GameMap {
  const plan = { center: { x: 20, y: 20 }, nodes: [], edges: [], slots: [], lots, wards: [], civics, market: [] } as unknown as SettlementPlan;
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

  it('settles the footprint slightly INTO grade (composed mean below base mean)', () => {
    const map = mapWith([lot('a', 10, 10, 3, 4, true)]);
    const store = new DeformationStore();
    store.add(...buildSettlementPadDeformations(map));
    const cells = map.settlementPlans![0].lots[0].tiles;
    const baseMean = cells.reduce((s, t) => s + heightMetresAt(map, t.x, t.y), 0) / cells.length;
    const compMean = cells.reduce((s, t) => s + heightAt(map, store, t.x, t.y), 0) / cells.length;
    const settle = baseMean - compMean;
    expect(settle).toBeGreaterThan(0.05); // sits below grade (settle depth ~0.12 m)
    expect(settle).toBeLessThan(0.25);
  });

  it('feathers WIDER than the old 1.5 tiles — the pad still bites ~2 tiles beyond the edge', () => {
    const map = mapWith([lot('a', 10, 10, 3, 4, true)]);
    const [pad] = buildSettlementPadDeformations(map);
    // Footprint spans x∈[10,12]; two tiles out (x=14) is still inside the widened feather.
    expect(pad.mask(14, 11)).toBeGreaterThan(0);
    expect(pad.mask(15, 11)).toBe(0); // beyond feather → untouched
  });

  it('pads civic precincts (well/graveyard/mill) but NEVER the tended green', () => {
    const civics: CivicSite[] = [
      { type: 'well', x: 30, y: 30, w: 1, h: 1 },
      { type: 'graveyard', x: 40, y: 40, w: 2, h: 2 },
      { type: 'green', x: 18, y: 18, w: 3, h: 3 },
    ];
    const defs = buildSettlementPadDeformations(mapWith([lot('a', 10, 10, 3, 4, true)], civics));
    const ids = defs.map(d => d.id);
    expect(ids).toContain('pad:a'); // the built lot 'a'
    expect(ids.some(i => i.startsWith('pad:civic:well:'))).toBe(true);
    expect(ids.some(i => i.startsWith('pad:civic:graveyard:'))).toBe(true);
    expect(ids.some(i => i.startsWith('pad:civic:green:'))).toBe(false); // green stays flush
  });

  it('settlementBuildCount counts only built lots', () => {
    expect(settlementBuildCount(mapWith([lot('a', 10, 10, 3, 4, true), lot('b', 20, 20, 3, 4, false)]))).toBe(1);
    expect(settlementBuildCount({ seed: 1, width: 8, height: 8 } as unknown as GameMap)).toBe(0);
  });
});
