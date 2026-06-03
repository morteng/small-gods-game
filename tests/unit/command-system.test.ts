import { describe, it, expect } from 'vitest';
import { executeCommand, CommandExecutorSystem } from '@/sim/command/command-system';
import { CommandQueue } from '@/sim/command/command-queue';
import type { Command, CommandResult, ApplyCtx } from '@/sim/command/types';
import { CAPABILITY_REGISTRY } from '@/sim/command/registry';
import { World } from '@/world/world';
import { SimClock } from '@/core/clock';
import { EventLog } from '@/core/events';
import { initNpcProps } from '@/world/npc-helpers';
import { whisper } from '@/sim/divine-actions';
import type { Entity, GameMap, NpcProperties } from '@/core/types';
import type { Spirit, SpiritId } from '@/core/spirit';
import { createRng } from '@/core/rng';

function tinyMap(): GameMap {
  const tiles = [] as GameMap['tiles'];
  for (let y = 0; y < 3; y++) {
    const row = [];
    for (let x = 0; x < 3; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
    tiles.push(row as never);
  }
  return { tiles, width: 3, height: 3, villages: [], seed: 1, success: true, worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] } as unknown as GameMap;
}

function spirit(power = 100, id: SpiritId = 'player'): Spirit {
  return { id, name: 'You', sigil: '✦', color: '#fff', isPlayer: id === 'player', power, manifestation: null };
}

function worldNpc(id: string, setup: (p: NpcProperties) => void): Entity {
  const p = initNpcProps(id, 'farmer', 7);
  p.homePoiId = 'poi1';
  setup(p);
  return { id, kind: 'npc', x: 0, y: 0, properties: p as unknown as Record<string, unknown> };
}

function P(e: Entity): NpcProperties { return e.properties as unknown as NpcProperties; }

function ctx(world: World, spirits: Map<SpiritId, Spirit>): ApplyCtx {
  return { world, spirits, log: new EventLog(new SimClock()), rng: createRng(1), now: 0 };
}

function command(over: Partial<Command>): Command {
  return { verb: 'whisper', source: 'player', target: { kind: 'npc', npcId: 'a' }, seq: 0, ...over };
}

describe('executeCommand', () => {
  it('applies a whisper — parity with a direct divine-actions call', () => {
    const world = new World(tinyMap());
    const e = worldNpc('a', (p) => { p.whisperCooldown = 0; p.beliefs['player'] = { faith: 0.3, understanding: 0.2, devotion: 0.1 }; });
    world.addEntity(e);
    const spirits = new Map([['player', spirit(10)]]);

    const res = executeCommand(command({}), ctx(world, spirits));
    expect(res.status).toBe('applied');

    // Twin fixture run through divine-actions.whisper directly must match.
    const twinWorld = new World(tinyMap());
    const twin = worldNpc('a', (p) => { p.whisperCooldown = 0; p.beliefs['player'] = { faith: 0.3, understanding: 0.2, devotion: 0.1 }; });
    twinWorld.addEntity(twin);
    whisper(spirit(10), twin, new EventLog(new SimClock()));

    expect(P(e).beliefs['player'].faith).toBeCloseTo(P(twin).beliefs['player'].faith, 6);
    expect(P(e).beliefs['player'].understanding).toBeCloseTo(P(twin).beliefs['player'].understanding, 6);
    expect(spirits.get('player')!.power).toBe(9); // cost paid
  });

  it('rejects insufficient_power and leaves state untouched', () => {
    const world = new World(tinyMap());
    const e = worldNpc('a', (p) => { p.whisperCooldown = 0; p.beliefs['player'] = { faith: 0.3, understanding: 0.2, devotion: 0.1 }; });
    world.addEntity(e);
    const spirits = new Map([['player', spirit(0)]]);

    const res = executeCommand(command({}), ctx(world, spirits));
    expect(res).toEqual({ status: 'rejected', verb: 'whisper', source: 'player', reason: 'insufficient_power' });
    expect(P(e).beliefs['player'].faith).toBe(0.3);
  });

  it('rejects precondition_failed for a whisper on a cooled-down NPC', () => {
    const world = new World(tinyMap());
    world.addEntity(worldNpc('a', (p) => { p.whisperCooldown = 3; }));
    const res = executeCommand(command({}), ctx(world, new Map([['player', spirit(10)]])));
    expect((res as Extract<CommandResult, { status: 'rejected' }>).reason).toBe('precondition_failed');
  });

  it('rejects precondition_failed for answer_prayer when not worshipping', () => {
    const world = new World(tinyMap());
    world.addEntity(worldNpc('a', (p) => { p.activity = 'idle'; }));
    const res = executeCommand(command({ verb: 'answer_prayer' }), ctx(world, new Map([['player', spirit(10)]])));
    expect((res as Extract<CommandResult, { status: 'rejected' }>).reason).toBe('precondition_failed');
  });

  it('rejects not_implemented for each authoring verb without mutating state', () => {
    const world = new World(tinyMap());
    const spirits = new Map([['player', spirit(100)]]);
    for (const verb of ['bias_event', 'inject_npc', 'nudge_severity'] as Command['verb'][]) {
      const res = executeCommand(command({ verb, target: { kind: 'settlement', poiId: 'poi1' } }), ctx(world, spirits));
      expect((res as Extract<CommandResult, { status: 'rejected' }>).reason).toBe('not_implemented');
    }
    expect(spirits.get('player')!.power).toBe(100);
  });

  it('rejects invalid_target (npc verb pointed at a settlement / missing npc)', () => {
    const world = new World(tinyMap());
    const spirits = new Map([['player', spirit(10)]]);
    expect((executeCommand(command({ target: { kind: 'settlement', poiId: 'poi1' } }), ctx(world, spirits)) as Extract<CommandResult, { status: 'rejected' }>).reason).toBe('invalid_target');
    expect((executeCommand(command({ target: { kind: 'npc', npcId: 'ghost' } }), ctx(world, spirits)) as Extract<CommandResult, { status: 'rejected' }>).reason).toBe('invalid_target');
  });

  it('rejects unknown_source', () => {
    const world = new World(tinyMap());
    world.addEntity(worldNpc('a', (p) => { p.whisperCooldown = 0; }));
    const res = executeCommand(command({ source: 'nobody' }), ctx(world, new Map([['player', spirit(10)]])));
    expect((res as Extract<CommandResult, { status: 'rejected' }>).reason).toBe('unknown_source');
  });
});

describe('editor tier (foundation)', () => {
  it('declares the five editor verbs as cost-0 editor-tier capabilities', () => {
    const editorVerbs = ['author_spawn_npc', 'author_remove_entity', 'author_modify_npc', 'author_place_object', 'author_move_entity'] as const;
    for (const v of editorVerbs) {
      const def = CAPABILITY_REGISTRY[v];
      expect(def).toBeDefined();
      expect(def.tier).toBe('editor');
      expect(def.cost).toBe(0);
    }
  });

  it('rejects an unimplemented (authoring-tier) verb with not_implemented before any tier branch', () => {
    const world = new World(tinyMap());
    const res = executeCommand(
      command({ verb: 'bias_event', source: 'author', target: { kind: 'none' } }),
      ctx(world, new Map()),
    );
    expect(res).toEqual({ status: 'rejected', verb: 'bias_event', source: 'author', reason: 'not_implemented' });
  });
});

describe('CommandExecutorSystem', () => {
  it('drains queued commands FIFO in one tick', () => {
    const world = new World(tinyMap());
    world.addEntity(worldNpc('a', (p) => { p.whisperCooldown = 0; }));
    world.addEntity(worldNpc('b', (p) => { p.whisperCooldown = 0; }));
    const spirits = new Map([['player', spirit(10)]]);
    const log = new EventLog(new SimClock());

    const queue = new CommandQueue();
    const results: CommandResult[] = [];
    const sys = new CommandExecutorSystem(queue, (r) => results.push(r));

    queue.emit({ verb: 'whisper', source: 'player', target: { kind: 'npc', npcId: 'a' } });
    queue.emit({ verb: 'whisper', source: 'player', target: { kind: 'npc', npcId: 'b' } });

    sys.tick({ world, spirits, log, clock: new SimClock(), rng: createRng(1), dt: 16, now: 1 });

    expect(results.map(r => r.status)).toEqual(['applied', 'applied']);
    expect(queue.size()).toBe(0);
    expect(spirits.get('player')!.power).toBe(8); // two whispers @ cost 1
  });
});
