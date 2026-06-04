import { describe, it, expect } from 'vitest';
import { executeCommand } from '@/sim/command/command-system';
import type { ApplyCtx, Command } from '@/sim/command/types';
import { World } from '@/world/world';
import { SimClock } from '@/core/clock';
import { EventLog } from '@/core/events';
import { createRng } from '@/core/rng';
import { initNpcProps, npcProps, queryNpcs } from '@/world/npc-helpers';
import type { Entity, GameMap, NpcProperties, Tile } from '@/core/types';
import type { Spirit, SpiritId } from '@/core/spirit';
import { FATE_ROLE_MAP } from '@/sim/command/authoring-verbs';

function bigMap(n = 12): GameMap {
  const tiles: GameMap['tiles'] = [];
  for (let y = 0; y < n; y++) {
    const row = [];
    for (let x = 0; x < n; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
    tiles.push(row as never);
  }
  return { tiles, width: n, height: n, villages: [], seed: 1, success: true, worldSeed: null,
           stats: { iterations: 0, backtracks: 0 }, buildings: [] } as unknown as GameMap;
}
function applyCtx(world: World, now = 10): ApplyCtx {
  return { world, spirits: new Map<SpiritId, Spirit>(), log: new EventLog(new SimClock()), rng: createRng(42), now };
}
function resident(id: string, x: number, y: number, poiId = 'poi1'): Entity {
  const p = initNpcProps(id, 'farmer', 7);
  p.homeX = x; p.homeY = y; p.homePoiId = poiId;
  return { id, kind: 'npc', x, y, properties: p as unknown as Record<string, unknown> };
}
function injectCmd(poiId: string, role: string): Command {
  return { verb: 'inject_npc', source: 'fate', target: { kind: 'settlement', poiId }, payload: { role }, seq: 0 };
}

describe('inject_npc', () => {
  it('spawns one stranger of the mapped role near a resident of the poi, faith 0', () => {
    const world = new World(bigMap());
    world.addEntity(resident('r1', 5, 5));
    const before = queryNpcs(world).length;
    const res = executeCommand(injectCmd('poi1', 'preacher'), applyCtx(world));
    expect(res.status).toBe('applied');
    const npcs = queryNpcs(world);
    expect(npcs.length).toBe(before + 1);
    const stranger = npcs.find(e => e.id !== 'r1')!;
    const p = npcProps(stranger) as NpcProperties;
    expect(p.role).toBe(FATE_ROLE_MAP.preacher);   // 'priest'
    expect(p.fateRole).toBe('preacher');
    expect(p.beliefs.player.faith).toBe(0);
  });

  it('rejects an unknown role with invalid_payload', () => {
    const world = new World(bigMap());
    world.addEntity(resident('r1', 5, 5));
    const res = executeCommand(injectCmd('poi1', 'wizard'), applyCtx(world));
    expect(res).toMatchObject({ status: 'rejected', reason: 'invalid_payload' });
  });

  it('rejects a poi with no resident (unresolvable center) with invalid_target', () => {
    const world = new World(bigMap());
    world.addEntity(resident('r1', 5, 5, 'poi1'));
    const res = executeCommand(injectCmd('poiX', 'refugee'), applyCtx(world));
    expect(res).toMatchObject({ status: 'rejected', reason: 'invalid_target' });
  });
});

function biasMap(): GameMap {
  const tiles: Tile[][] = [];
  for (let y = 0; y < 2; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < 2; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
    tiles.push(row);
  }
  return { tiles, width: 2, height: 2, villages: [], seed: 1, success: true,
           worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] };
}
function biasCtx(world: World): ApplyCtx {
  return { world, spirits: new Map(), log: new EventLog(new SimClock()), rng: createRng(1), now: 0 };
}
function biasCmd(payload: Record<string, unknown>, poiId = 'poi1'): Command {
  return { verb: 'bias_event', source: 'fate', target: { kind: 'settlement', poiId }, payload, seq: 0 };
}

describe('bias_event', () => {
  it('sets world.forcedEvents for a valid eventType', () => {
    const world = new World(biasMap());
    const res = executeCommand(biasCmd({ eventType: 'plague' }), biasCtx(world));
    expect(res.status).toBe('applied');
    expect(world.forcedEvents.get('poi1')).toBe('plague');
  });

  it('rejects an unknown eventType as invalid_payload', () => {
    const world = new World(biasMap());
    const res = executeCommand(biasCmd({ eventType: 'banana' }), biasCtx(world));
    expect(res).toMatchObject({ status: 'rejected', reason: 'invalid_payload' });
    expect(world.forcedEvents.size).toBe(0);
  });

  it('rejects a non-settlement target as invalid_target', () => {
    const world = new World(biasMap());
    const cmd: Command = { verb: 'bias_event', source: 'fate', target: { kind: 'none' }, payload: { eventType: 'drought' }, seq: 0 };
    const res = executeCommand(cmd, biasCtx(world));
    expect(res).toMatchObject({ status: 'rejected', reason: 'invalid_target' });
  });
});

function nudgeCmd(delta: unknown, poiId = 'poi1'): Command {
  return { verb: 'nudge_severity', source: 'fate', target: { kind: 'settlement', poiId }, payload: { delta }, seq: 0 };
}
function withEvent(world: World, severity: number) {
  world.activeEvents.set('poi1', [{ type: 'drought', poiId: 'poi1', severity, durationTicks: 100, ticksElapsed: 0 }]);
}

describe('nudge_severity', () => {
  it('raises severity and clamps at 1.0', () => {
    const world = new World(biasMap()); withEvent(world, 0.8);
    const res = executeCommand(nudgeCmd(0.5), biasCtx(world));
    expect(res.status).toBe('applied');
    expect(world.activeEvents.get('poi1')![0].severity).toBe(1.0);
  });

  it('lowers severity and clamps at the 0.05 floor', () => {
    const world = new World(biasMap()); withEvent(world, 0.2);
    executeCommand(nudgeCmd(-0.5), biasCtx(world));
    expect(world.activeEvents.get('poi1')![0].severity).toBe(0.05);
  });

  it('caps the per-call magnitude at ±0.5 (isolated from the result clamp)', () => {
    const world = new World(biasMap()); withEvent(world, 0.3);
    executeCommand(nudgeCmd(5.0), biasCtx(world));   // capped to +0.5 → 0.3 + 0.5 = 0.8 (not 1.0)
    expect(world.activeEvents.get('poi1')![0].severity).toBe(0.8);
  });

  it('rejects precondition_failed when the POI has no active event', () => {
    const world = new World(biasMap());
    const res = executeCommand(nudgeCmd(0.2), biasCtx(world));
    expect(res).toMatchObject({ status: 'rejected', reason: 'precondition_failed' });
  });

  it('rejects a non-finite delta as invalid_payload', () => {
    const world = new World(biasMap()); withEvent(world, 0.5);
    const res = executeCommand(nudgeCmd('lots'), biasCtx(world));
    expect(res).toMatchObject({ status: 'rejected', reason: 'invalid_payload' });
  });
});
