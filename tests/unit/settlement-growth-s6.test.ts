// tests/unit/settlement-growth-s6.test.ts — civic life (S6): graveyard-filling,
// the working mill building, and ward rename/retype verbs.
import { describe, it, expect, beforeAll } from 'vitest';
import { World } from '@/world/world';
import { SimClock } from '@/core/clock';
import { EventLog } from '@/core/events';
import { createRng } from '@/core/rng';
import { initNpcProps } from '@/world/npc-helpers';
import { killNpc } from '@/world/npc-lifecycle';
import { recordBurial } from '@/world/civic';
import { applySkip } from '@/sim/time-skip';
import { placeSettlement } from '@/world/building-placer';
import { executeCommand } from '@/sim/command/command-system';
import {
  renameWardPrecondition, renameWardApply, retypeWardPrecondition, retypeWardApply,
} from '@/sim/command/ward-verbs';
import type { Command, ApplyCtx } from '@/sim/command/types';
import { getZoneRule } from '@/map/poi-zones';
import { ensureBuildingTypesRegistered } from '@/blueprint/register-buildings';
import { blueprintOf } from '@/blueprint/entity';
import { Random } from '@/core/noise';
import type { Entity, GameMap, Tile, POI } from '@/core/types';

beforeAll(() => ensureBuildingTypesRegistered());

const CENTER = { x: 24, y: 24 };
const POI_ID = 'v1';

function grassTiles(w = 48, h = 48): Tile[][] {
  return Array.from({ length: h }, (_, y) =>
    Array.from({ length: w }, (_, x) =>
      ({ x, y, type: 'grass', walkable: true, state: 'realized' }) as unknown as Tile));
}

/** A village world with a real plan, roads applied, worldgen buildings in.
 *  `water` paints a river column near the centre so a mill gets planned. */
function villageWorld(seed = 11, water = false) {
  const tiles = grassTiles();
  if (water) {
    // A short river column a few tiles east of centre — within mill range of
    // buildable ground, but not on the settlement core.
    for (let y = CENTER.y - 3; y <= CENTER.y + 3; y++) {
      const t = tiles[y]?.[CENTER.x + 7];
      if (t) { (t as { type: string }).type = 'river'; (t as { walkable: boolean }).walkable = false; }
    }
  }
  const poi: POI = { id: POI_ID, type: 'village', name: 'T', position: CENTER } as unknown as POI;
  const map: GameMap = {
    tiles, width: 48, height: 48, villages: [], seed: 1, success: true,
    worldSeed: { pois: [poi] } as unknown as GameMap['worldSeed'],
    stats: { iterations: 0, backtracks: 0 }, buildings: [],
  } as GameMap;
  const world = new World(map);
  const rule = { ...getZoneRule('village'), radius: { min: 10, max: 10 }, buildingCount: { min: 2, max: 2 } };
  const result = placeSettlement(
    poi, rule, tiles, world.registry, [{ dx: 1, dy: 0 }],
    new Random(seed), 'medieval', world, 42,
  );
  for (const e of result.entities) world.indexExisting(e);
  for (const rt of result.roadTiles) {
    const t = tiles[rt.y]?.[rt.x];
    if (t) { (t as { type: string }).type = rt.type; (t as { walkable: boolean }).walkable = true; }
  }
  map.settlementPlans = [result.plan];
  return { world, map, plan: result.plan, entities: result.entities };
}

function addNpc(world: World, id: string, poiId: string | undefined): Entity {
  const p = initNpcProps(id, 'farmer', 1);
  p.homePoiId = poiId;
  p.birthTick = 0;
  const e: Entity = { id, kind: 'npc', x: CENTER.x, y: CENTER.y,
    properties: p as unknown as Record<string, unknown> };
  world.addEntity(e);
  return e;
}

function graveyardOf(world: World, poiId = POI_ID): Entity | undefined {
  return [...world.query({ kind: 'graveyard' })].find(g => g.properties?.poiId === poiId);
}

// ─── Sub-slice A: graveyard-filling ──────────────────────────────────────────

describe('graveyard-filling (buried count)', () => {
  it('recordBurial increments the matching settlement graveyard', () => {
    const { world } = villageWorld();
    const yard = graveyardOf(world)!;
    expect(yard).toBeDefined();
    expect(yard.properties?.buried ?? 0).toBe(0);
    recordBurial(world, POI_ID);
    recordBurial(world, POI_ID);
    expect(yard.properties?.buried).toBe(2);
  });

  it('is a no-op when the poi has no graveyard', () => {
    const { world } = villageWorld();
    // a foreign poi id → nothing to tally, no throw
    expect(() => recordBurial(world, 'elsewhere')).not.toThrow();
    expect(() => recordBurial(world, undefined)).not.toThrow();
    expect(graveyardOf(world)!.properties?.buried ?? 0).toBe(0);
  });

  it('killNpc buries the dead into their home settlement graveyard', () => {
    const { world } = villageWorld();
    const npc = addNpc(world, 'mortal-1', POI_ID);
    const clock = new SimClock();
    killNpc(world, npc, 1000, 'old_age', new EventLog(clock));
    expect(graveyardOf(world)!.properties?.buried).toBe(1);
    // the dead still persist as remains (the count, not relocation)
    expect(world.registry.get('mortal-1')?.kind).toBe('remains');
  });

  it('a death with no home settlement does not throw and tallies nothing', () => {
    const { world } = villageWorld();
    const drifter = addNpc(world, 'drifter', undefined);
    expect(() => killNpc(world, drifter, 1000, 'old_age', new EventLog(new SimClock()))).not.toThrow();
    expect(graveyardOf(world)!.properties?.buried ?? 0).toBe(0);
  });

  it('applySkip accrues burials over deep time', () => {
    const { world } = villageWorld();
    for (let i = 0; i < 12; i++) addNpc(world, `m${i}`, POI_ID);
    const clock = new SimClock();
    const before = (graveyardOf(world)!.properties?.buried as number) ?? 0;
    applySkip(world, clock, createRng(9), new EventLog(clock), 120);
    const after = (graveyardOf(world)!.properties?.buried as number) ?? 0;
    expect(after).toBeGreaterThan(before);
  });
});

// ─── Sub-slice B: the working mill ───────────────────────────────────────────

describe('mill as a working building', () => {
  function millOf(entities: Entity[]): Entity | undefined {
    return entities.find(e => e.properties?.civic === 'mill');
  }

  it('emits the mill as a blueprint building on a waterside village', () => {
    const { plan, entities } = villageWorld(11, true);
    const millSite = plan.civics.find(c => c.type === 'mill');
    expect(millSite, 'a waterside village plans a mill').toBeDefined();
    const mill = millOf(entities)!;
    expect(mill, 'the mill is emitted as an entity').toBeDefined();
    // it is a real building (carries a blueprint), not a bare prop
    expect(blueprintOf(mill)).toBeDefined();
    expect(blueprintOf(mill)!.rb.preset).toBe('watermill');
    expect(mill.tags).toContain('building');
    expect(mill.tags).toContain('workplace');
    expect([mill.x, mill.y]).toEqual([millSite!.x, millSite!.y]);
  });

  it('keeps dwellings off the mill footprint', () => {
    const { plan, entities } = villageWorld(11, true);
    const millSite = plan.civics.find(c => c.type === 'mill')!;
    const millSet = new Set<string>();
    for (let dy = 0; dy < millSite.h; dy++)
      for (let dx = 0; dx < millSite.w; dx++) millSet.add(`${millSite.x + dx},${millSite.y + dy}`);
    for (const e of entities) {
      if (e.properties?.civic === 'mill') continue;
      const bp = blueprintOf(e);
      if (!bp) continue;
      for (let dy = 0; dy < bp.collision.footprint.h; dy++)
        for (let dx = 0; dx < bp.collision.footprint.w; dx++)
          expect(millSet.has(`${e.x + dx},${e.y + dy}`),
            `dwelling on mill tile ${e.x + dx},${e.y + dy}`).toBe(false);
    }
  });

  it('plans no mill (and emits none) for a landlocked village', () => {
    const { plan, entities } = villageWorld(11, false);
    expect(plan.civics.some(c => c.type === 'mill')).toBe(false);
    expect(entities.some(e => e.properties?.civic === 'mill')).toBe(false);
  });
});

// ─── Sub-slice C: ward verbs ─────────────────────────────────────────────────

describe('rename_ward / retype_ward', () => {
  function ctxFor(world: World, seed = 4): ApplyCtx {
    const clock = new SimClock();
    return { world, spirits: new Map(), log: new EventLog(clock), rng: createRng(seed), now: 100 } as ApplyCtx;
  }
  const cmd = (verb: Command['verb'], target: Command['target'], payload?: Record<string, unknown>): Command =>
    ({ verb, source: 'fate', target, payload, seq: 1 });

  it('renames a ward in place', () => {
    const { world, plan } = villageWorld();
    expect(plan.wards.length).toBeGreaterThan(0);
    const ward = plan.wards[0];
    const ok = renameWardApply(
      cmd('rename_ward', { kind: 'settlement', poiId: POI_ID }, { wardId: ward.id, name: 'Tanners Row' }),
      ctxFor(world));
    expect(ok).toBe(true);
    expect(ward.name).toBe('Tanners Row');
  });

  it('retypes a ward to a valid district type', () => {
    const { world, plan } = villageWorld();
    const ward = plan.wards[0];
    const ok = retypeWardApply(
      cmd('retype_ward', { kind: 'settlement', poiId: POI_ID }, { wardId: ward.id, type: 'craft' }),
      ctxFor(world));
    expect(ok).toBe(true);
    expect(ward.type).toBe('craft');
  });

  it('rejects a bad target, missing ward, empty name, and invalid type', () => {
    const { world, plan } = villageWorld();
    const ctx = ctxFor(world);
    const ward = plan.wards[0];
    expect(renameWardPrecondition(cmd('rename_ward', { kind: 'npc', npcId: 'x' }, { wardId: ward.id, name: 'X' }), ctx)).toBe('invalid_target');
    expect(renameWardPrecondition(cmd('rename_ward', { kind: 'settlement', poiId: 'nope' }, { wardId: ward.id, name: 'X' }), ctx)).toBe('invalid_target');
    expect(renameWardPrecondition(cmd('rename_ward', { kind: 'settlement', poiId: POI_ID }, { wardId: 'ward:0,0', name: 'X' }), ctx)).toBe('invalid_target');
    expect(renameWardPrecondition(cmd('rename_ward', { kind: 'settlement', poiId: POI_ID }, { wardId: ward.id, name: '  ' }), ctx)).toBe('invalid_payload');
    expect(retypeWardPrecondition(cmd('retype_ward', { kind: 'settlement', poiId: POI_ID }, { wardId: ward.id, type: 'bogus' }), ctx)).toBe('invalid_payload');
  });

  it('runs end-to-end through executeCommand (authoring tier)', () => {
    const { world, plan } = villageWorld();
    const ward = plan.wards[0];
    const clock = new SimClock();
    const ctx = { world, spirits: new Map(), log: new EventLog(clock), rng: createRng(2), now: 200 } as ApplyCtx;
    const res = executeCommand(
      cmd('rename_ward', { kind: 'settlement', poiId: POI_ID }, { wardId: ward.id, name: 'Goldsmiths Ward' }), ctx);
    expect(res.status).toBe('applied');
    expect(ward.name).toBe('Goldsmiths Ward');
  });
});
