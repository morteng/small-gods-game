// tests/unit/settlement-growth-s5.test.ts — skip integration, grow_settlement
// Fate lever, and civic entity emission (S5).
import { describe, it, expect, beforeAll } from 'vitest';
import { World } from '@/world/world';
import { SimClock } from '@/core/clock';
import { EventLog } from '@/core/events';
import { createRng } from '@/core/rng';
import { initNpcProps } from '@/world/npc-helpers';
import {
  growSettlement, growSettlementsOnSkip, housingCapacityByPoi, residentsByPoi,
  type GrowthCtx,
} from '@/sim/systems/settlement-growth-system';
import { placeSettlement } from '@/world/building-placer';
import { applySkip } from '@/sim/time-skip';
import { executeCommand } from '@/sim/command/command-system';
import { growSettlementPrecondition, growSettlementApply } from '@/sim/command/settlement-verbs';
import type { Command, ApplyCtx } from '@/sim/command/types';
import { getZoneRule } from '@/map/poi-zones';
import { ensureBuildingTypesRegistered } from '@/blueprint/register-buildings';
import { blueprintOf } from '@/blueprint/entity';
import { tryGetEntityKindDef } from '@/world/entity-kinds';
import { Random } from '@/core/noise';
import type { GameMap, Tile, POI } from '@/core/types';

beforeAll(() => ensureBuildingTypesRegistered());

const CENTER = { x: 24, y: 24 };
const POI_ID = 'v1';

function grassTiles(w = 48, h = 48): Tile[][] {
  return Array.from({ length: h }, (_, y) =>
    Array.from({ length: w }, (_, x) =>
      ({ x, y, type: 'grass', walkable: true, state: 'realized' }) as unknown as Tile));
}

/** A village world with a real plan, roads applied, worldgen buildings in. */
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

function addNpcs(world: World, n: number, poiId = POI_ID): void {
  for (let i = 0; i < n; i++) {
    const id = `npc${i}`;
    const p = initNpcProps(id, 'farmer', (i * 977) | 0);
    p.homePoiId = poiId;
    world.addEntity({ id, kind: 'npc', x: CENTER.x, y: CENTER.y,
      properties: p as unknown as Record<string, unknown> });
  }
}

function growthCtx(world: World, seed = 5): GrowthCtx {
  const clock = new SimClock();
  return { world, rng: createRng(seed), now: 0, log: new EventLog(clock) };
}

function buildingCount(world: World, poiId = POI_ID): number {
  let n = 0;
  for (const e of world.query({})) {
    if (e.properties?.poiId === poiId && blueprintOf(e)) n++;
  }
  return n;
}

// ─── Part 1: shared growth path (free fn, tag-keyed ids, boolean return) ──────

describe('growSettlement (shared free function)', () => {
  it('uses the tag to avoid the per-tick id collision a shared tag hits', () => {
    // A SHARED tag 5× — the "already acted this tag" id guard means at most one
    // new dwelling lands within the single logical tick.
    const a = villageWorld();
    const actx = growthCtx(a.world);
    const beforeA = buildingCount(a.world);
    for (let s = 0; s < 5; s++) growSettlement(actx, a.plan, 'same');
    const sameTagGain = buildingCount(a.world) - beforeA;
    expect(sameTagGain).toBe(1);

    // DISTINCT tags 5× — several dwellings land within the one tick (the skip /
    // command paths rely on exactly this).
    const b = villageWorld();
    const bctx = growthCtx(b.world);
    const beforeB = buildingCount(b.world);
    for (let s = 0; s < 5; s++) growSettlement(bctx, b.plan, `t${s}`);
    const distinctGain = buildingCount(b.world) - beforeB;
    expect(distinctGain).toBeGreaterThan(sameTagGain);
  });

  it('returns false once the settlement saturates', () => {
    const { world, plan } = villageWorld();
    const ctx = growthCtx(world);
    let steps = 0;
    while (growSettlement(ctx, plan, `t${steps}`) && steps < 500) steps++;
    expect(steps).toBeGreaterThan(0);
    expect(growSettlement(ctx, plan, 'final')).toBe(false);
  });
});

// ─── Part 2: time-skip integration ───────────────────────────────────────────

describe('growSettlementsOnSkip', () => {
  it('grows housing toward the resident population, then stops', () => {
    const { world } = villageWorld();
    addNpcs(world, 40);
    const pop = residentsByPoi(world).get(POI_ID)!;
    expect(pop).toBe(40);
    const capBefore = housingCapacityByPoi(world).get(POI_ID) ?? 0;
    expect(capBefore).toBeLessThan(pop);

    const steps = growSettlementsOnSkip(world, createRng(3), 1000, new EventLog(new SimClock()));
    expect(steps).toBeGreaterThan(0);
    const capAfter = housingCapacityByPoi(world).get(POI_ID) ?? 0;
    // either housing caught up to the population, or the settlement saturated
    expect(capAfter).toBeGreaterThan(capBefore);
  });

  it('does nothing when there is no population pressure', () => {
    const { world } = villageWorld();
    addNpcs(world, 2); // ≤ starting capacity
    const before = buildingCount(world);
    const steps = growSettlementsOnSkip(world, createRng(3), 1000, new EventLog(new SimClock()));
    expect(steps).toBe(0);
    expect(buildingCount(world)).toBe(before);
  });

  it('is deterministic — same seed yields the same end state', () => {
    const run = () => {
      const { world } = villageWorld();
      addNpcs(world, 40);
      growSettlementsOnSkip(world, createRng(7), 1000, new EventLog(new SimClock()));
      return buildingCount(world);
    };
    expect(run()).toBe(run());
  });

  it('applySkip grows a populated settlement over the jump', () => {
    const { world } = villageWorld();
    addNpcs(world, 50);
    const before = buildingCount(world);
    const clock = new SimClock();
    applySkip(world, clock, createRng(9), new EventLog(clock), 50);
    expect(buildingCount(world)).toBeGreaterThan(before);
  });
});

// ─── Part 3: grow_settlement command (Fate lever) ────────────────────────────

describe('grow_settlement command', () => {
  function applyCtx(world: World, seed = 4): ApplyCtx {
    const clock = new SimClock();
    return {
      world, spirits: new Map(), log: new EventLog(clock),
      rng: createRng(seed), now: 100,
    } as ApplyCtx;
  }
  const cmd = (target: Command['target'], payload?: Record<string, unknown>): Command =>
    ({ verb: 'grow_settlement', source: 'fate', target, payload, seq: 1 });

  it('grows the settlement when applied', () => {
    const { world } = villageWorld();
    const before = buildingCount(world);
    const ok = growSettlementApply(cmd({ kind: 'settlement', poiId: POI_ID }, { steps: 4 }), applyCtx(world));
    expect(ok).toBe(true);
    expect(buildingCount(world)).toBeGreaterThan(before);
  });

  it('honours the steps budget', () => {
    const { world } = villageWorld();
    const before = buildingCount(world);
    growSettlementApply(cmd({ kind: 'settlement', poiId: POI_ID }, { steps: 3 }), applyCtx(world));
    // at most `steps` new dwellings (ribbon/back-lane carves may consume a step
    // without placing, so this is an upper bound)
    expect(buildingCount(world) - before).toBeLessThanOrEqual(3);
    expect(buildingCount(world)).toBeGreaterThan(before);
  });

  it('rejects a non-settlement target', () => {
    const { world } = villageWorld();
    const ctx = applyCtx(world);
    expect(growSettlementPrecondition(cmd({ kind: 'npc', npcId: 'x' }), ctx)).toBe('invalid_target');
  });

  it('rejects an unknown settlement', () => {
    const { world } = villageWorld();
    const ctx = applyCtx(world);
    expect(growSettlementPrecondition(cmd({ kind: 'settlement', poiId: 'nope' }), ctx)).toBe('invalid_target');
  });

  it('rejects a non-numeric steps payload', () => {
    const { world } = villageWorld();
    const ctx = applyCtx(world);
    const c = cmd({ kind: 'settlement', poiId: POI_ID }, { steps: 'lots' });
    expect(growSettlementPrecondition(c, ctx)).toBe('invalid_payload');
  });

  it('runs end-to-end through executeCommand (authoring tier, no spirit/cost gate)', () => {
    const { world } = villageWorld();
    const before = buildingCount(world);
    const clock = new SimClock();
    const ctx = {
      world, spirits: new Map(), log: new EventLog(clock),
      rng: createRng(2), now: 200,
    } as ApplyCtx;
    const res = executeCommand(cmd({ kind: 'settlement', poiId: POI_ID }, { steps: 2 }), ctx);
    expect(res.status).toBe('applied');
    expect(buildingCount(world)).toBeGreaterThan(before);
  });
});

// ─── Part 4: civic entity emission + reservation ─────────────────────────────

describe('civic entity emission', () => {
  it('emits a well and a graveyard as standing props, on reserved tiles', () => {
    const { entities, plan } = villageWorld();
    const civics = entities.filter(e => e.properties?.civic);
    const well = civics.find(e => e.kind === 'well');
    const yard = civics.find(e => e.kind === 'graveyard');
    expect(well).toBeDefined();
    expect(yard).toBeDefined();
    // graveyard kind is a registered prop
    expect(tryGetEntityKindDef('graveyard')?.category).toBe('prop');
    // each civic entity sits at its planned precinct origin
    for (const c of plan.civics) {
      if (c.type !== 'well' && c.type !== 'graveyard') continue;
      const e = civics.find(ce => ce.properties?.civic === c.type)!;
      expect([e.x, e.y]).toEqual([c.x, c.y]);
    }
  });

  it('keeps building footprints off every civic precinct tile', () => {
    const { entities, plan } = villageWorld(23);
    const civicSet = new Set<string>();
    for (const c of plan.civics) {
      for (let dy = 0; dy < c.h; dy++) {
        for (let dx = 0; dx < c.w; dx++) civicSet.add(`${c.x + dx},${c.y + dy}`);
      }
    }
    for (const e of entities) {
      const bp = blueprintOf(e);
      if (!bp) continue; // skip the civic props themselves
      for (let dy = 0; dy < bp.collision.footprint.h; dy++) {
        for (let dx = 0; dx < bp.collision.footprint.w; dx++) {
          expect(civicSet.has(`${e.x + dx},${e.y + dy}`),
            `building on civic tile ${e.x + dx},${e.y + dy}`).toBe(false);
        }
      }
    }
  });

  it('registers civic entities in the world (queryable like any entity)', () => {
    const { world } = villageWorld();
    const wells = [...world.query({})].filter(e => e.kind === 'well' && e.properties?.poiId === POI_ID);
    expect(wells.length).toBe(1);
  });
});
