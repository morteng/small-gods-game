// tests/unit/settlement-growth-system.test.ts — live growth from population pressure (S3)
import { describe, it, expect, beforeAll } from 'vitest';
import { World } from '@/world/world';
import { SimClock } from '@/core/clock';
import { EventLog, type SimEvent } from '@/core/events';
import { createRng } from '@/core/rng';
import { initNpcProps } from '@/world/npc-helpers';
import { SettlementGrowthSystem, DWELLING_CAPACITY, UPGRADE_CHAINS, growSettlement } from '@/sim/systems/settlement-growth-system';
import { computeSettlementParcels } from '@/world/settlement-parcels';
import type { SettlementPlan } from '@/world/settlement-plan';
import { placeSettlement } from '@/world/building-placer';
import { reconcileSettlementTiles } from '@/world/settlement-reconcile';
import { captureSnapshot, restoreSnapshot } from '@/core/snapshot';
import { getZoneRule } from '@/map/poi-zones';
import { ensureBuildingTypesRegistered } from '@/blueprint/register-buildings';
import { blueprintOf } from '@/blueprint/entity';
import { Random } from '@/core/noise';
import type { GameMap, Tile, POI, Entity } from '@/core/types';
import type { GameState } from '@/core/state';

beforeAll(() => ensureBuildingTypesRegistered());

const CENTER = { x: 24, y: 24 };
const POI_ID = 'v1';

function grassTiles(w = 48, h = 48): Tile[][] {
  return Array.from({ length: h }, (_, y) =>
    Array.from({ length: w }, (_, x) =>
      ({ x, y, type: 'grass', walkable: true, state: 'realized' }) as unknown as Tile));
}

/** A village world with a real settlement plan, roads applied, worldgen buildings in.
 *  Wide radius + few worldgen buildings so plenty of frontage stays free for growth. */
function villageWorld(seed = 11) {
  const tiles = grassTiles();
  const poi: POI = { id: POI_ID, type: 'village', name: 'T', position: CENTER } as unknown as POI;
  const map: GameMap = {
    tiles, width: 48, height: 48, villages: [], seed: 1, success: true,
    worldSeed: { pois: [poi] } as unknown as GameMap['worldSeed'],
    stats: { iterations: 0, backtracks: 0 }, buildings: [],
  } as GameMap;
  const world = new World(map);
  const rule = {
    ...getZoneRule('village'),
    radius: { min: 10, max: 10 },
    buildingCount: { min: 2, max: 2 },
  };
  const result = placeSettlement(
    poi, rule, tiles, world.registry, [{ dx: 1, dy: 0 }],
    new Random(seed), 'medieval', world, 42,
  );
  for (const e of result.entities) world.indexExisting(e);
  for (const rt of result.roadTiles) {
    const t = tiles[rt.y]?.[rt.x];
    if (t) { t.type = rt.type; t.walkable = true; }
  }
  map.settlementPlans = [result.plan];
  return { world, map, plan: result.plan, entities: result.entities };
}

function addNpc(world: World, id: string): Entity {
  const p = initNpcProps(id, 'farmer', (id.charCodeAt(id.length - 1) * 977) | 0);
  p.homePoiId = POI_ID;
  const e: Entity = { id, kind: 'npc', x: CENTER.x, y: CENTER.y,
    properties: p as unknown as Record<string, unknown> };
  world.addEntity(e);
  return e;
}

function ctxFor(world: World, seed: number) {
  const clock = new SimClock();
  const log = new EventLog(clock);
  const grown: SimEvent[] = [];
  log.subscribe((a: { event: SimEvent }) => {
    if (a.event.type === 'settlement_grown') grown.push(a.event);
  });
  return { ctx: { world, spirits: new Map(), log, clock, rng: createRng(seed), dt: 1000, now: 0 }, grown };
}

function capacityOf(world: World): number {
  let cap = 0;
  for (const e of world.query({})) {
    const preset = blueprintOf(e)?.rb.preset;
    if (preset && (e.properties?.poiId === POI_ID)) cap += DWELLING_CAPACITY[preset] ?? 0;
  }
  return cap;
}

describe('SettlementGrowthSystem', () => {
  it('grows a dwelling on a free lot under population pressure', () => {
    const { world, plan } = villageWorld();
    const cap = capacityOf(world);
    for (let i = 0; i < cap + 6; i++) addNpc(world, `npc${i}`);
    const { ctx, grown } = ctxFor(world, 3);
    const sys = new SettlementGrowthSystem();
    for (let t = 0; t < 400 && grown.length === 0; t++) sys.tick({ ...ctx, now: t });

    expect(grown.length).toBeGreaterThan(0);
    const ev = grown[0] as Extract<SimEvent, { type: 'settlement_grown' }>;
    expect(ev.poiId).toBe(POI_ID);
    const e = world.registry.get(ev.entityId)!;
    expect(e).toBeDefined();
    // sits on its claimed lot, fully inside it
    const lot = plan.lots.find(l => l.id === ev.lotId)!;
    expect(lot.buildingId).toBe(ev.entityId);
    const set = new Set(lot.tiles.map(t => `${t.x},${t.y}`));
    const bp = blueprintOf(e)!;
    for (let dy = 0; dy < bp.collision.footprint.h; dy++) {
      for (let dx = 0; dx < bp.collision.footprint.w; dx++) {
        expect(set.has(`${e.x + dx},${e.y + dy}`)).toBe(true);
      }
    }
    // footprint stamped: non-walkable except doors
    const doors = new Set(bp.collision.doorCells);
    for (let dy = 0; dy < bp.collision.footprint.h; dy++) {
      for (let dx = 0; dx < bp.collision.footprint.w; dx++) {
        expect(world.tiles.tiles[e.y + dy][e.x + dx].walkable).toBe(doors.has(`${dx},${dy}`));
      }
    }
  });

  it('does not grow at or under capacity, or without a plan', () => {
    const { world, map } = villageWorld();
    const cap = capacityOf(world);
    for (let i = 0; i < Math.max(1, cap - 1); i++) addNpc(world, `npc${i}`);
    const { ctx, grown } = ctxFor(world, 3);
    const sys = new SettlementGrowthSystem();
    for (let t = 0; t < 300; t++) sys.tick({ ...ctx, now: t });
    expect(grown).toHaveLength(0);

    // no plan → no growth even over capacity
    map.settlementPlans = [];
    for (let i = 0; i < cap + 20; i++) addNpc(world, `extra${i}`);
    for (let t = 0; t < 300; t++) sys.tick({ ...ctx, now: t });
    expect(grown).toHaveLength(0);
  });

  it('eventually relieves pressure and stops (capacity catches up or lots run out)', () => {
    const { world } = villageWorld();
    const cap = capacityOf(world);
    for (let i = 0; i < cap + 30; i++) addNpc(world, `npc${i}`);
    const { ctx, grown } = ctxFor(world, 9);
    const sys = new SettlementGrowthSystem();
    for (let t = 0; t < 3000; t++) sys.tick({ ...ctx, now: t });
    const after = grown.length;
    expect(after).toBeGreaterThan(0);
    // either capacity now covers the population, or all matching lots are used —
    // and growth has stopped either way
    for (let t = 3000; t < 3600; t++) sys.tick({ ...ctx, now: t });
    const totalPop = cap + 30;
    if (capacityOf(world) < totalPop) {
      expect(grown.length).toBe(after);   // saturated: no further growth
    }
  });

  it('extends the through street (ribbon growth) once the original frontage saturates', () => {
    const { world, plan } = villageWorld();
    const cap = capacityOf(world);
    // heavy, sustained pressure: enough to exhaust the original lots and force
    // at least one ribbon extension
    for (let i = 0; i < cap + 60; i++) addNpc(world, `npc${i}`);
    const nodesBefore = plan.nodes.length;
    const throughLenBefore = plan.edges
      .filter(e => e.kind === 'through').reduce((n, e) => n + e.tiles.length, 0);

    const { ctx } = ctxFor(world, 4);
    const sys = new SettlementGrowthSystem();
    for (let t = 0; t < 4000; t++) sys.tick({ ...ctx, now: t });

    // the graph grew: a former end node became a junction + a new edge/end appeared
    expect(plan.nodes.length).toBeGreaterThan(nodesBefore);
    const throughLenAfter = plan.edges
      .filter(e => e.kind === 'through').reduce((n, e) => n + e.tiles.length, 0);
    expect(throughLenAfter).toBeGreaterThan(throughLenBefore);
    // grown dwellings include ones on lots that did not exist before extending
    const grownBuildings = plan.lots.filter(l => l.buildingId?.includes('_bld_g'));
    expect(grownBuildings.length).toBeGreaterThan(0);
  });

  it('upgrades a dwelling in place once lots and ribbon are exhausted', () => {
    // cottage → townhouse is the canonical upgrade chain
    expect(UPGRADE_CHAINS.cottage).toBe('townhouse');
    const { world, plan } = villageWorld();
    const cap = capacityOf(world);
    // sustained, heavy pressure so growth saturates lots + ribbon, then densifies
    for (let i = 0; i < cap + 80; i++) addNpc(world, `npc${i}`);
    const clock = new SimClock();
    const log = new EventLog(clock);
    const upgrades: SimEvent[] = [];
    log.subscribe((a: { event: SimEvent }) => {
      if (a.event.type === 'settlement_upgraded') upgrades.push(a.event);
    });
    const ctx = { world, spirits: new Map(), log, clock, rng: createRng(5), dt: 1000, now: 0 };
    const sys = new SettlementGrowthSystem();
    const capBefore = capacityOf(world);
    for (let t = 0; t < 6000 && upgrades.length === 0; t++) sys.tick({ ...ctx, now: t });

    expect(upgrades.length).toBeGreaterThan(0);
    const ev = upgrades[0] as Extract<SimEvent, { type: 'settlement_upgraded' }>;
    expect(ev.to).toBe(UPGRADE_CHAINS[ev.from]);
    // the upgraded entity replaced the old one on the same lot, raising capacity
    const lot = plan.lots.find(l => l.id === ev.lotId)!;
    expect(lot.buildingId).toBe(ev.entityId);
    expect(world.registry.get(ev.entityId)).toBeDefined();
    expect(blueprintOf(world.registry.get(ev.entityId)!)!.rb.preset).toBe(ev.to);
    expect(DWELLING_CAPACITY[ev.to]).toBeGreaterThan(DWELLING_CAPACITY[ev.from]);
    expect(capacityOf(world)).toBeGreaterThan(capBefore);
  });

  it('branches a back lane after the through street caps out', () => {
    const { world, plan } = villageWorld();
    const cap = capacityOf(world);
    for (let i = 0; i < cap + 120; i++) addNpc(world, `npc${i}`);
    const laneEdgesBefore = plan.edges.filter(e => e.kind === 'lane').length;
    const { ctx } = ctxFor(world, 6);
    const sys = new SettlementGrowthSystem();
    const laneCount = () => plan.edges.filter(e => e.kind === 'lane').length;
    for (let t = 0; t < 8000 && laneCount() <= laneEdgesBefore; t++) sys.tick({ ...ctx, now: t });
    // a perpendicular lane was branched off the saturated street graph
    expect(plan.edges.filter(e => e.kind === 'lane').length).toBeGreaterThan(laneEdgesBefore);
  });

  it('annexes a far bank across a bridge once the home bank saturates (town → bridge → suburb)', () => {
    // A world split by a full-height river column at x=28: a west home bank, an east far bank,
    // a one-tile channel between. The plan starts with NO home-bank lots, so growth exhausts
    // every home avenue immediately and reaches the annexation step.
    const tiles = grassTiles();
    for (let y = 0; y < 48; y++) { const t = tiles[y][28]; t.type = 'river'; t.walkable = false; }
    const poi: POI = { id: POI_ID, type: 'village', name: 'T', position: CENTER } as unknown as POI;
    const map: GameMap = {
      tiles, width: 48, height: 48, villages: [], seed: 1, success: true,
      worldSeed: { pois: [poi] } as unknown as GameMap['worldSeed'],
      stats: { iterations: 0, backtracks: 0 }, buildings: [],
    } as GameMap;
    const world = new World(map);
    const parcels = computeSettlementParcels(CENTER.x, CENTER.y, tiles, 20)!;
    expect(parcels.crossings.length).toBeGreaterThan(0);
    const plan: SettlementPlan = {
      poiId: POI_ID, center: { ...CENTER },
      nodes: [{ id: 'n0', x: CENTER.x, y: CENTER.y, kind: 'founding' }],
      edges: [], slots: [], lots: [], wards: [], civics: [], market: [], parcels,
    };
    map.settlementPlans = [plan];

    const clock = new SimClock();
    const log = new EventLog(clock);
    const ctx = { world, spirits: new Map(), log, clock, rng: createRng(3), dt: 1000, now: 0 };

    // First step reaches the annexation branch: bridge laid, far bank recorded, suburb lots seated.
    growSettlement(ctx, plan, 't0');
    expect(plan.annexed).toEqual([parcels.adjacent[0].id]);
    expect(plan.edges.some(e => e.kind === 'bridge')).toBe(true);
    // The channel now carries a walkable bridge deck, with the river preserved
    // underneath (baseType) so it renders as a span over water, not a causeway.
    const deck = tiles.map(row => row[28]).find(t => t.type === 'bridge');
    expect(deck).toBeTruthy();
    expect(deck!.walkable).toBe(true);
    expect(deck!.baseType).toBe('river');
    // Suburb burgage lots exist on the far (east) bank.
    expect(plan.lots.some(l => l.tiles.some(t => t.x > 28))).toBe(true);
    // The annexed bridge is REAL STRUCTURE, not bare tiles: the same parametric deck
    // worldgen crossings get (buildCrossingSpanEntities) joined the world at the channel.
    const spanDecks = [...world.query({ kind: 'bridge_deck' })];
    expect(spanDecks.length).toBeGreaterThan(0);
    expect(Math.abs(spanDecks[0].x - 28)).toBeLessThanOrEqual(3);   // seated at the crossing

    // Keep growing: dwellings now fill the far-bank suburb (varied presets → varied facings).
    for (let i = 0; i < 40; i++) growSettlement(ctx, plan, `t${i + 1}`);
    const farBuilt = plan.lots.filter(l => l.buildingId && l.tiles.some(t => t.x > 28));
    expect(farBuilt.length).toBeGreaterThan(0);
    for (const l of farBuilt) expect(world.registry.get(l.buildingId!)).toBeDefined();
  });

  it('is deterministic for identical worlds and seeds', () => {
    const runOnce = () => {
      const { world } = villageWorld(11);
      const cap = capacityOf(world);
      for (let i = 0; i < cap + 8; i++) addNpc(world, `npc${i}`);
      const { ctx, grown } = ctxFor(world, 7);
      const sys = new SettlementGrowthSystem();
      for (let t = 0; t < 800; t++) sys.tick({ ...ctx, now: t });
      return grown.map(g => {
        const e = g as Extract<SimEvent, { type: 'settlement_grown' }>;
        return `${e.entityId}:${e.preset}:${e.lotId}`;
      });
    };
    const a = runOnce();
    expect(a.length).toBeGreaterThan(0);
    expect(runOnce()).toEqual(a);
  });
});

describe('reconcileSettlementTiles', () => {
  it('frees lots and tiles claimed by a building absent from the restored world', () => {
    const { world, map, plan } = villageWorld();
    const cap = capacityOf(world);
    for (let i = 0; i < cap + 6; i++) addNpc(world, `npc${i}`);
    const { ctx, grown } = ctxFor(world, 3);
    const sys = new SettlementGrowthSystem();
    for (let t = 0; t < 400 && grown.length === 0; t++) sys.tick({ ...ctx, now: t });
    const ev = grown[0] as Extract<SimEvent, { type: 'settlement_grown' }>;
    const lot = plan.lots.find(l => l.id === ev.lotId)!;
    expect(lot.buildingId).toBe(ev.entityId);

    // Simulate a restore to a pre-growth snapshot: same map, world without the building.
    world.removeEntity(ev.entityId);
    reconcileSettlementTiles(map, world);
    expect(lot.buildingId).toBeUndefined();
    for (const t of lot.tiles) {
      expect(map.tiles[t.y][t.x].walkable).toBe(true);
    }
    // worldgen buildings still stamped + their lots re-claimed
    for (const l of plan.lots.filter(l => l.buildingId)) {
      expect(world.registry.get(l.buildingId!)).toBeDefined();
    }
  });

  it('round-trips through capture/restoreSnapshot', () => {
    const { world, map, plan } = villageWorld();
    const cap = capacityOf(world);
    for (let i = 0; i < cap + 6; i++) addNpc(world, `npc${i}`);

    const clock = new SimClock();
    const state = {
      map, world, clock, rng: createRng(1), spirits: new Map(),
      eventLog: new EventLog(clock),
    } as unknown as GameState;
    const snap = captureSnapshot(state);

    const { ctx, grown } = ctxFor(world, 3);
    const sys = new SettlementGrowthSystem();
    for (let t = 0; t < 400 && grown.length === 0; t++) sys.tick({ ...ctx, now: t });
    const ev = grown[0] as Extract<SimEvent, { type: 'settlement_grown' }>;
    const lot = plan.lots.find(l => l.id === ev.lotId)!;

    restoreSnapshot(state, snap);
    expect(state.world!.query({}).find(e => e.id === ev.entityId)).toBeUndefined();
    expect(lot.buildingId).toBeUndefined();
    for (const t of lot.tiles) expect(map.tiles[t.y][t.x].walkable).toBe(true);
  });
});
