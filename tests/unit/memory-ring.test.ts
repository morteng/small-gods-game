// WP-C: NPC memory-ring completeness — the SimEvent kinds that used to bypass
// `recentEventIds` (omen/miracle witnesses, smite witnesses, deaths of relations,
// births, own faith/mood crossings, faith lapses, home floods) now land in the
// rings of the NPCs who would plausibly know. The ring feeds LLM narration.

import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import { SimClock } from '@/core/clock';
import { EventLog } from '@/core/events';
import { createRng } from '@/core/rng';
import { initNpcProps, npcProps, rememberEvent, RECENT_EVENT_CAP } from '@/world/npc-helpers';
import { killNpc, birthNpc } from '@/world/npc-lifecycle';
import { omen, miracle, smite, smiteLocation } from '@/sim/divine-actions';
import { NpcSimSystem } from '@/sim/systems/npc-sim-system';
import { AbandonmentSystem } from '@/sim/systems/abandonment-system';
import { WeatherSystem } from '@/sim/systems/weather-system';
import type { GameMap, Entity, NpcProperties } from '@/core/types';
import type { Spirit } from '@/core/spirit';

function makeWorld(): World {
  return new World({
    tiles: [], width: 20, height: 20, villages: [], seed: 1,
    success: true, worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [],
  } as GameMap);
}

function makeLog(): { clock: SimClock; log: EventLog } {
  const clock = new SimClock();
  return { clock, log: new EventLog(clock) };
}

function addNpc(world: World, id: string, opts: {
  faith?: number; poiId?: string; x?: number; y?: number;
  relationships?: NpcProperties['relationships'];
} = {}): Entity {
  const props = initNpcProps('Pip', 'farmer', 7);
  props.beliefs['player'].faith = opts.faith ?? 0.5;
  if (opts.poiId) props.homePoiId = opts.poiId;
  if (opts.relationships) props.relationships = opts.relationships;
  const e: Entity = {
    id, kind: 'npc', x: opts.x ?? 0, y: opts.y ?? 0,
    properties: props as unknown as Record<string, unknown>,
  };
  world.addEntity(e);
  return e;
}

function spirit(power = 100): Spirit {
  return { id: 'player', name: 'You', sigil: '☀', color: '#fff', isPlayer: true, power, manifestation: null };
}

function ring(e: Entity): number[] {
  return npcProps(e).recentEventIds;
}

describe('rememberEvent — the shared ring writer', () => {
  it('caps the ring at RECENT_EVENT_CAP, evicting oldest', () => {
    const props = initNpcProps('Pip', 'farmer', 7);
    for (let i = 1; i <= RECENT_EVENT_CAP + 3; i++) rememberEvent(props, i);
    expect(props.recentEventIds).toHaveLength(RECENT_EVENT_CAP);
    expect(props.recentEventIds[0]).toBe(4); // 1..3 evicted
    expect(props.recentEventIds[props.recentEventIds.length - 1]).toBe(RECENT_EVENT_CAP + 3);
  });

  it('skips non-positive ids (SilentEventLog replay appends return id 0)', () => {
    const props = initNpcProps('Pip', 'farmer', 7);
    rememberEvent(props, 0);
    rememberEvent(props, -1);
    expect(props.recentEventIds).toEqual([]);
  });
});

describe('divine actions stamp witness rings', () => {
  it('omen enters every resident ring at the poi', () => {
    const world = makeWorld();
    const { log } = makeLog();
    const a = addNpc(world, 'a', { poiId: 'vale' });
    const b = addNpc(world, 'b', { poiId: 'vale' });
    const far = addNpc(world, 'far', { poiId: 'elsewhere' });
    expect(omen(spirit(), 'vale', world, log)).toBe(true);
    expect(ring(a)).toHaveLength(1);
    expect(ring(b)).toHaveLength(1);
    expect(ring(far)).toHaveLength(0);
    expect(log.getById(ring(a)[0])!.event.type).toBe('omen');
  });

  it('miracle enters every resident ring at the poi', () => {
    const world = makeWorld();
    const { log } = makeLog();
    const a = addNpc(world, 'a', { poiId: 'vale' });
    expect(miracle(spirit(), 'vale', world, log)).toBe(true);
    expect(log.getById(ring(a)[0])!.event.type).toBe('miracle');
  });

  it('smite enters the target ring AND each settlement witness ring', () => {
    const world = makeWorld();
    const { log } = makeLog();
    const target = addNpc(world, 'target', { poiId: 'vale' });
    const witness = addNpc(world, 'witness', { poiId: 'vale' });
    const far = addNpc(world, 'far', { poiId: 'elsewhere' });
    expect(smite(spirit(), target, world, log)).toBe(true);
    expect(log.getById(ring(target)[0])!.event.type).toBe('smite');
    expect(log.getById(ring(witness)[0])!.event.type).toBe('smite');
    expect(ring(far)).toHaveLength(0);
  });

  it('smiteLocation enters the rings of NPCs within the witness radius', () => {
    const world = makeWorld();
    const { log } = makeLog();
    const near = addNpc(world, 'near', { x: 5, y: 5 });
    const far = addNpc(world, 'far', { x: 19, y: 19 });
    expect(smiteLocation(spirit(), 5, 6, world, log)).toBe(true);
    expect(log.getById(ring(near)[0])!.event.type).toBe('smite');
    expect(ring(far)).toHaveLength(0);
  });
});

describe('lifecycle events stamp the rings of those who would know', () => {
  it('npc_death enters the deceased ring and every living relation ring', () => {
    const world = makeWorld();
    const { log } = makeLog();
    const friend = addNpc(world, 'friend', {});
    const stranger = addNpc(world, 'stranger', {});
    const doomed = addNpc(world, 'doomed', {
      relationships: [{ npcId: 'friend', type: 'friend', trust: 0.8 }],
    });
    killNpc(world, doomed, 100, 'old_age', log);
    expect(log.getById(ring(friend)[0])!.event.type).toBe('npc_death');
    expect(npcProps(doomed).recentEventIds.map(id => log.getById(id)!.event.type)).toContain('npc_death');
    expect(ring(stranger)).toHaveLength(0);
  });

  it('npc_birth enters the child ring and each parent ring', () => {
    const world = makeWorld();
    const { log } = makeLog();
    const ma = addNpc(world, 'ma', {});
    const pa = addNpc(world, 'pa', {});
    const child = birthNpc(world, [ma, pa], 50, createRng(1), log);
    expect(log.getById(ring(child)[0])!.event.type).toBe('npc_birth');
    expect(log.getById(ring(ma)[0])!.event.type).toBe('npc_birth');
    expect(log.getById(ring(pa)[0])!.event.type).toBe('npc_birth');
  });
});

describe('system-emitted events stamp the subject ring', () => {
  it('belief_cross and mood_cross enter the crossing NPC own ring', () => {
    const world = makeWorld();
    const { clock, log } = makeLog();
    const sys = new NpcSimSystem();
    const e = addNpc(world, 'n1', { faith: 0.9 });
    // mood is recomputed from needs inside tickNpcEntity — drive it via needs.
    npcProps(e).needs = { safety: 1, prosperity: 1, community: 1, meaning: 1 };
    sys.tick({ world, log, clock, spirits: new Map(), rng: createRng(0), dt: 1000, now: 0 });
    const kinds = ring(e).map(id => log.getById(id)!.event.type);
    expect(kinds).toContain('belief_cross');
    expect(kinds).toContain('mood_cross');
  });

  it('believer_lost enters the lapsed NPC own ring', () => {
    const world = makeWorld();
    const { clock, log } = makeLog();
    const sys = new AbandonmentSystem();
    const e = addNpc(world, 'n1', { faith: 0.9 });
    const ctx = { world, log, clock, spirits: new Map(), rng: createRng(0), dt: 1000, now: 0 };
    sys.tick(ctx); // observed as a believer
    npcProps(e).beliefs['player'].faith = 0;
    for (let i = 0; i < 12; i++) sys.tick(ctx); // grace ticks elapse
    const kinds = ring(e).map(id => log.getById(id)!.event.type);
    expect(kinds).toContain('believer_lost');
  });

  it('place_flooded enters every resident ring at the flooded poi', () => {
    const world = makeWorld();
    const { clock, log } = makeLog();
    const wet = addNpc(world, 'wet', { poiId: 'vale' });
    const dry = addNpc(world, 'dry', { poiId: 'elsewhere' });
    const stepper = {
      stepTick: () => {}, floodOffsetM: () => new Float32Array(0),
      floodPoi: () => 0,
    };
    const watch = {
      poll: () => [{ type: 'flooded' as const, placeId: 'vale', name: 'Vale', depthM: 2, coverage: 0.5 }],
    };
    const sys = new WeatherSystem(
      () => stepper as never, () => watch as never,
    );
    sys.tick({ world, log, clock, spirits: new Map(), rng: createRng(0), dt: 1000, now: 0 });
    expect(log.getById(ring(wet)[0])!.event.type).toBe('place_flooded');
    expect(ring(dry)).toHaveLength(0);
  });
});
