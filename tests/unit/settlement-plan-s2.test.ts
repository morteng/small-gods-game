// tests/unit/settlement-plan-s2.test.ts — lots, wards, market, wear (growth S2)
import { describe, it, expect, beforeAll } from 'vitest';
import {
  planSettlement, subdivideLots, widenMarket, assignWards, WATER_TYPES,
} from '@/world/settlement-plan';
import { prewarmAllSettlementWear } from '@/world/settlement-wear';
import { TrampleGrid } from '@/sim/trample';
import { placeSettlement } from '@/world/building-placer';
import { getZoneRule } from '@/map/poi-zones';
import { ensureBuildingTypesRegistered } from '@/blueprint/register-buildings';
import { blueprintOf } from '@/blueprint/entity';
import { World } from '@/world/world';
import { Random } from '@/core/noise';
import type { GameMap, Tile, POI } from '@/core/types';

beforeAll(() => ensureBuildingTypesRegistered());

function grassTiles(w = 48, h = 48): Tile[][] {
  return Array.from({ length: h }, (_, y) =>
    Array.from({ length: w }, (_, x) =>
      ({ x, y, type: 'grass', walkable: true }) as unknown as Tile));
}

function emptyMap(tiles: Tile[][]): GameMap {
  return { tiles, width: tiles[0].length, height: tiles.length, villages: [], seed: 1,
    success: true, worldSeed: null, stats: { iterations: 0, backtracks: 0 },
    buildings: [] } as unknown as GameMap;
}

const CENTER = { x: 24, y: 24 };
const villageRule = getZoneRule('village');

function freshPlan(tiles = grassTiles(), rule = villageRule, seed = 7) {
  return planSettlement(CENTER, rule, tiles, [{ dx: 1, dy: 0 }], new Random(seed));
}

describe('subdivideLots', () => {
  it('produces non-overlapping lots off-road, off-water, in-bounds', () => {
    const tiles = grassTiles();
    for (let x = 0; x < 48; x++) tiles[27][x].type = 'river';
    const plan = freshPlan(tiles);
    const lots = subdivideLots(plan, tiles, 1234);
    expect(lots.length).toBeGreaterThan(0);
    const roadSet = new Set(plan.edges.flatMap(e => e.tiles.map(t => `${t.x},${t.y}`)));
    const seen = new Set<string>();
    for (const lot of lots) {
      expect(lot.frontage.length).toBeGreaterThanOrEqual(1);   // end-of-edge remainder lots can be short
      expect(lot.frontage.length).toBeLessThanOrEqual(4);
      expect(lot.depth).toBeGreaterThanOrEqual(3);
      expect(lot.depth).toBeLessThanOrEqual(5);
      for (const t of lot.tiles) {
        const k = `${t.x},${t.y}`;
        expect(roadSet.has(k), `lot tile on road at ${k}`).toBe(false);
        expect(WATER_TYPES.has(tiles[t.y]?.[t.x]?.type), `lot tile on water at ${k}`).toBe(false);
        expect(seen.has(k), `lot overlap at ${k}`).toBe(false);
        seen.add(k);
      }
    }
  });

  it('is keyed on road-tile coordinates: same lots regardless of edge order', () => {
    const tiles = grassTiles();
    const a = freshPlan(tiles);
    const b = freshPlan(tiles);
    b.edges.reverse();
    const lotsA = subdivideLots(a, tiles, 99);
    const lotsB = subdivideLots(b, tiles, 99);
    // Dimensions are a pure function of the first frontage tile's coords —
    // identical for every lot id present in both subdivisions. (Junction
    // tile contention is resolved by edge order, so the lot SET may differ.)
    const dimsA = new Map(lotsA.map(l => [l.id, `${l.frontage.length}x${l.depth}`]));
    const shared = lotsB.filter(l => dimsA.has(l.id));
    expect(shared.length).toBeGreaterThan(0);
    for (const l of shared) expect(`${l.frontage.length}x${l.depth}`).toBe(dimsA.get(l.id));
  });
});

describe('widenMarket', () => {
  it('widens the through street near the founding node', () => {
    const tiles = grassTiles();
    const plan = freshPlan(tiles);
    const market = widenMarket(plan, tiles);
    expect(market.length).toBeGreaterThan(0);
    const throughTiles = plan.edges.filter(e => e.kind === 'through').flatMap(e => e.tiles);
    for (const m of market) {
      // adjacent to a through-road tile, within ~3 of the founding node
      expect(throughTiles.some(t => Math.abs(t.x - m.x) + Math.abs(t.y - m.y) === 1)).toBe(true);
      expect(Math.abs(m.x - CENTER.x) + Math.abs(m.y - CENTER.y)).toBeLessThanOrEqual(3);
    }
  });

  it('is empty for road-less layouts', () => {
    const tiles = grassTiles();
    const plan = planSettlement(CENTER, getZoneRule('temple'), tiles, [], new Random(7));
    expect(widenMarket(plan, tiles)).toEqual([]);
  });
});

describe('assignWards', () => {
  it('covers the non-water disc, names are unique, founding ward is the market', () => {
    const tiles = grassTiles();
    const plan = freshPlan(tiles);
    const wards = assignWards(plan, 8, tiles, 555);
    expect(wards.length).toBeGreaterThanOrEqual(3);
    const names = wards.map(w => w.name);
    expect(new Set(names).size).toBe(names.length);
    // every in-disc tile belongs to exactly one ward
    const owned = new Map<string, number>();
    wards.forEach((w, i) => w.tiles.forEach(t => {
      const k = `${t.x},${t.y}`;
      expect(owned.has(k), `tile ${k} in two wards`).toBe(false);
      owned.set(k, i);
    }));
    const centerWard = wards[owned.get(`${CENTER.x},${CENTER.y}`)!];
    expect(centerWard.type).toBe('market');
    expect(centerWard.name).toMatch(/Market/);
  });

  it('creates a harbour ward when water is in radius, deterministically', () => {
    const tiles = grassTiles();
    for (let x = 0; x < 48; x++) for (const y of [30, 31]) tiles[y][x].type = 'shallow_water';
    const plan = freshPlan(tiles);
    const a = assignWards(plan, 8, tiles, 555);
    const b = assignWards(freshPlan(grassTiles().map((row, y) => row.map(t => ({ ...t, type: tiles[y][t.x].type }))) as Tile[][]), 8, tiles, 555);
    expect(a.some(w => w.type === 'harbour')).toBe(true);
    expect(b.map(w => [w.id, w.name, w.type])).toEqual(a.map(w => [w.id, w.name, w.type]));
  });
});

describe('placeSettlement — lot claiming', () => {
  const poi: POI = { id: 'v1', type: 'village', name: 'Test', position: CENTER } as unknown as POI;

  function run(seed = 11, tiles = grassTiles()) {
    const world = new World(emptyMap(tiles));
    const result = placeSettlement(
      poi, villageRule, tiles, world.registry, [{ dx: 1, dy: 0 }],
      new Random(seed), 'medieval', world, 42,
    );
    return { world, result, tiles };
  }

  it('claims every lot a placed footprint intersects (no "free" lots with blocked tiles)', () => {
    const { result } = run();
    const claimed = result.plan.lots.filter(l => l.buildingId);
    expect(claimed.length).toBeGreaterThan(0);
    // every claimed lot's building exists and INTERSECTS the lot
    for (const lot of claimed) {
      const e = result.entities.find(en => en.id === lot.buildingId)!;
      expect(e).toBeDefined();
      const bp = blueprintOf(e)!;
      const set = new Set(lot.tiles.map(t => `${t.x},${t.y}`));
      let hit = false;
      for (let dy = 0; dy < bp.collision.footprint.h && !hit; dy++) {
        for (let dx = 0; dx < bp.collision.footprint.w && !hit; dx++) {
          if (set.has(`${e.x + dx},${e.y + dy}`)) hit = true;
        }
      }
      expect(hit, `claimed lot ${lot.id} not touched by its building`).toBe(true);
    }
    // and the converse: no unclaimed lot contains any footprint tile
    for (const lot of result.plan.lots.filter(l => !l.buildingId)) {
      const set = new Set(lot.tiles.map(t => `${t.x},${t.y}`));
      for (const e of result.entities.filter(e => blueprintOf(e)?.rb.class === 'building')) {
        const bp = blueprintOf(e)!;
        for (let dy = 0; dy < bp.collision.footprint.h; dy++) {
          for (let dx = 0; dx < bp.collision.footprint.w; dx++) {
            expect(set.has(`${e.x + dx},${e.y + dy}`),
              `unclaimed lot ${lot.id} holds footprint of ${e.id}`).toBe(false);
          }
        }
      }
    }
  });

  it('market tiles are carved as roads and stay clear of footprints', () => {
    const { result } = run();
    expect(result.plan.market.length).toBeGreaterThan(0);
    const roadSet = new Set(result.roadTiles.map(rt => `${rt.x},${rt.y}`));
    for (const m of result.plan.market) expect(roadSet.has(`${m.x},${m.y}`)).toBe(true);
    for (const e of result.entities.filter(e => blueprintOf(e)?.rb.class === 'building')) {
      const bp = blueprintOf(e)!;
      for (let dy = 0; dy < bp.collision.footprint.h; dy++) {
        for (let dx = 0; dx < bp.collision.footprint.w; dx++) {
          expect(result.plan.market.some(m => m.x === e.x + dx && m.y === e.y + dy)).toBe(false);
        }
      }
    }
  });

  it('exposes named wards on the plan', () => {
    const { result } = run();
    expect(result.plan.wards.length).toBeGreaterThanOrEqual(3);
    expect(result.plan.wards.some(w => w.type === 'market')).toBe(true);
  });

  it('stays deterministic with lots enabled', () => {
    const a = run(42);
    const b = run(42);
    expect(b.result.entities.map(e => [e.id, e.x, e.y]))
      .toEqual(a.result.entities.map(e => [e.id, e.x, e.y]));
    expect(b.result.plan.lots.map(l => [l.id, l.buildingId]))
      .toEqual(a.result.plan.lots.map(l => [l.id, l.buildingId]));
  });
});

// Settlement wear is now the GEN-TIME PREWARM of the desire-line trample grid
// (`@/sim/trample`): it seeds the accumulator around roads/markets and realises
// the initial worn dirt lanes. Same tile outcomes as the old one-shot pass, now
// as one entry point of the shared trample system.
describe('settlement wear prewarm', () => {
  function wornVillage(seed = 9) {
    const tiles = grassTiles();
    const map = emptyMap(tiles);
    const poi: POI = { id: 'v1', type: 'village', name: 'T', position: CENTER } as unknown as POI;
    const world = new World(map);
    const result = placeSettlement(
      poi, villageRule, tiles, world.registry, [{ dx: 1, dy: 0 }],
      new Random(seed), 'medieval', world, 42,
    );
    for (const rt of result.roadTiles) {
      const t = tiles[rt.y]?.[rt.x];
      if (t) { t.type = rt.type; t.walkable = true; }
    }
    const grid = new TrampleGrid(map.width, map.height);
    return { tiles, map, world, plan: result.plan, grid };
  }

  it('tramples soft ground beside roads to dirt, leaves the disc edge untouched', () => {
    const { tiles, map, world, plan, grid } = wornVillage();
    const changed = prewarmAllSettlementWear(grid, [plan], map, world, 42);
    expect(changed).toBeGreaterThan(0);
    // far corner untouched
    expect(tiles[2][2].type).toBe('grass');
    // dirt appears adjacent to road tiles somewhere
    const dirt = tiles.flat().filter(t => t.type === 'dirt');
    expect(dirt.length).toBe(changed);
    for (const d of dirt) expect(d.walkable).toBe(true);
    // every promoted trail is tracked on the grid (so it can decay/revert later)
    for (const d of dirt) expect(grid.isPromoted(d.x, d.y)).toBe(true);
  });

  it('never mutates roads, water, or building footprints', () => {
    const { tiles, map, world, plan, grid } = wornVillage();
    for (let x = 0; x < 48; x++) tiles[26][x].type = tiles[26][x].type === 'grass' ? 'river' : tiles[26][x].type;
    const before = tiles.map(row => row.map(t => `${t.type}|${t.walkable}`));
    prewarmAllSettlementWear(grid, [plan], map, world, 42);
    for (let y = 0; y < 48; y++) {
      for (let x = 0; x < 48; x++) {
        const [type, walkable] = before[y][x].split('|');
        if (type === 'river' || type === 'dirt_road' || walkable === 'false') {
          expect(`${tiles[y][x].type}|${tiles[y][x].walkable}`).toBe(before[y][x]);
        }
      }
    }
  });

  it('is deterministic for a fixed seed', () => {
    const a = wornVillage();
    const b = wornVillage();
    prewarmAllSettlementWear(a.grid, [a.plan], a.map, a.world, 42);
    prewarmAllSettlementWear(b.grid, [b.plan], b.map, b.world, 42);
    expect(b.tiles.map(r => r.map(t => t.type))).toEqual(a.tiles.map(r => r.map(t => t.type)));
    expect(b.grid.serialize()).toEqual(a.grid.serialize());
  });

  it('culls vegetation in the mid-wear band', () => {
    const { tiles, map, world, plan, grid } = wornVillage();
    // plant a tree right beside a road tile
    const road = plan.edges[0].tiles[1];
    const spot = { x: road.x, y: road.y - 1 };
    if (tiles[spot.y][spot.x].walkable !== false) {
      world.addEntity({
        id: 'tree1', kind: 'english-oak', x: spot.x, y: spot.y, tags: [], properties: {},
      } as never);
      prewarmAllSettlementWear(grid, [plan], map, world, 42);
      expect(world.registry.get('tree1')).toBeUndefined();
    }
  });
});
