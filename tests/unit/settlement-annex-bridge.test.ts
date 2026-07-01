import { describe, it, expect } from 'vitest';
import { annexAcrossBridge, type SettlementPlan } from '@/world/settlement-plan';
import { computeSettlementParcels } from '@/world/settlement-parcels';
import type { Tile } from '@/core/types';

// '.' grass, '~' river. A vertical river at x=5 splits a west home bank from an east bank.
function grid(rows: string[]): Tile[][] {
  return rows.map((row, y) => [...row].map((ch, x): Tile => ({
    type: ch === '~' ? 'river' : 'grass', x, y, walkable: ch !== '~', state: 'realized',
  })));
}

function bareplan(cx: number, cy: number, tiles: Tile[][]): SettlementPlan {
  const parcels = computeSettlementParcels(cx, cy, tiles, 20)!;
  return {
    poiId: 'p', center: { x: cx, y: cy },
    nodes: [{ id: 'n0', x: cx, y: cy, kind: 'founding' }],
    edges: [], slots: [], lots: [], wards: [], civics: [], market: [], parcels,
  };
}

const WIDE = [
  '.....~.....',
  '.....~.....',
  '.....~.....',
  '.....~.....',
  '.....~.....',
  '.....~.....',
  '.....~.....',
];

describe('annexAcrossBridge — town → bridge → suburb', () => {
  it('lays a bridge over the span and seats a far-bank suburb street with lots', () => {
    const tiles = grid(WIDE);
    const plan = bareplan(2, 3, tiles);
    const farId = plan.parcels!.adjacent[0].id;

    const res = annexAcrossBridge(plan, tiles, 42)!;
    expect(res).not.toBeNull();

    // The bridge deck covers the (single) water tile at x=5.
    expect(res.bridge.length).toBe(1);
    expect(res.bridge.every(t => tiles[t.y][t.x].type === 'river')).toBe(true);
    expect(res.bridge[0].x).toBe(5);

    // A bridge edge joined the graph, running unbroken west→east across the water.
    const bridgeEdge = plan.edges.find(e => e.kind === 'bridge')!;
    expect(bridgeEdge).toBeTruthy();
    const xs = bridgeEdge.tiles.map(t => t.x);
    expect(Math.min(...xs)).toBeLessThanOrEqual(4);   // home approach
    expect(Math.max(...xs)).toBeGreaterThanOrEqual(6); // far bank

    // Burgage lots now exist on the FAR bank (x ≥ 6) — the suburb the loop will fill.
    const farLots = plan.lots.filter(l => l.tiles.some(t => t.x >= 6));
    expect(farLots.length).toBeGreaterThan(0);

    // The far parcel is recorded as annexed.
    expect(plan.annexed).toContain(farId);
  });

  it('annexes each adjacent bank only once', () => {
    const tiles = grid(WIDE);
    const plan = bareplan(2, 3, tiles);
    expect(annexAcrossBridge(plan, tiles, 42)).not.toBeNull();
    // Only one adjacent bank exists and it's now annexed → nothing left to cross to.
    expect(annexAcrossBridge(plan, tiles, 42)).toBeNull();
  });

  it('returns null when the channel is unbridgeable (no crossing in the graph)', () => {
    // A 7-tile-wide river exceeds the max crossing span → no crossing → no annexation.
    const tiles = grid([
      '....~~~~~~~....',
      '....~~~~~~~....',
      '....~~~~~~~....',
      '....~~~~~~~....',
      '....~~~~~~~....',
    ]);
    const plan = bareplan(1, 2, tiles);
    expect(plan.parcels!.crossings.length).toBe(0);
    expect(annexAcrossBridge(plan, tiles, 42)).toBeNull();
  });

  it('does nothing for a dry inland site (no parcel graph)', () => {
    const tiles = grid(['....', '....', '....']);
    const plan: SettlementPlan = {
      poiId: 'p', center: { x: 1, y: 1 },
      nodes: [{ id: 'n0', x: 1, y: 1, kind: 'founding' }],
      edges: [], slots: [], lots: [], wards: [], civics: [], market: [],
      // no parcels (computeSettlementParcels returns null for dry sites)
    };
    expect(annexAcrossBridge(plan, tiles, 42)).toBeNull();
  });
});
