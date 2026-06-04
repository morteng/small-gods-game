import { describe, it, expect, beforeEach } from 'vitest';
import { World } from '@/world/world';
import { initNpcProps } from '@/world/npc-helpers';
import { EventLog, type AppendedEvent, type SimEvent } from '@/core/events';
import { SimClock } from '@/core/clock';
import { createRng } from '@/core/rng';
import { PlotThreadStore } from '@/sim/threads/thread-store';
import { RECOGNIZERS, recognizeLossGivenMeaning, LOSS_ABANDON_TICKS } from '@/sim/threads/recognizers';
import type { RecognizerCtx } from '@/sim/threads/recognizers';
import type { GameMap, Tile, NpcProperties } from '@/core/types';

function makeMap(): GameMap {
  const tiles: Tile[][] = [];
  for (let y = 0; y < 5; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < 5; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
    tiles.push(row);
  }
  return { tiles, width: 5, height: 5, villages: [], seed: 1, success: true,
           worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] };
}

function props(name: string, over: Partial<NpcProperties>): Record<string, unknown> {
  return { ...initNpcProps(name, 'farmer', 1), ...over } as unknown as Record<string, unknown>;
}

let world: World;
let ctx: RecognizerCtx;
let clock: SimClock;

function ev(event: SimEvent, id = 1): AppendedEvent { return { id, t: clock.now(), event }; }
function run(events: AppendedEvent[]): void { RECOGNIZERS.forEach(r => r(events, ctx)); }

beforeEach(() => {
  world = new World(makeMap());
  clock = new SimClock();
  ctx = {
    world,
    spirits: new Map(),
    store: new PlotThreadStore(),
    log: new EventLog(clock),
    rng: createRng(1),
    now: 0,
  };
});

describe('recognizeLossGivenMeaning', () => {
  beforeEach(() => {
    // A deceased believer (remains) and a living family member.
    world.addEntity({ id: 'n_dead', kind: 'remains', x: 1, y: 1,
      properties: props('Dad', { lineageId: 'L', beliefs: { player: { faith: 0.6, understanding: 0.3, devotion: 0.4 } } }) });
    world.addEntity({ id: 'n_kin', kind: 'npc', x: 2, y: 2,
      properties: props('Kid', { lineageId: 'L',
        relationships: [{ npcId: 'n_dead', type: 'family', trust: 0.9 }] }) });
  });

  it('a believer death opens a loss-given-meaning thread on a relative', () => {
    run([ev({ type: 'npc_death', npcId: 'n_dead', lineageId: 'L', cause: 'age' })]);
    const threads = ctx.store.bySubject({ kind: 'npc', npcId: 'n_kin' });
    expect(threads.some(t => t.shapeId === 'loss-given-meaning' && t.phase === 'loss')).toBe(true);
  });

  it('answering the bereaved resolves the thread', () => {
    run([ev({ type: 'npc_death', npcId: 'n_dead', lineageId: 'L', cause: 'age' })]);
    ctx.now = 100;
    run([ev({ type: 'answer_prayer', spiritId: 'player', npcId: 'n_kin' }, 2)]);
    const t = ctx.store.bySubject({ kind: 'npc', npcId: 'n_kin' })[0];
    expect(t.status).toBe('resolved');
    expect(t.phase).toBe('meaning');
  });

  it('does not open a second loss thread while one is active', () => {
    run([ev({ type: 'npc_death', npcId: 'n_dead', lineageId: 'L', cause: 'age' })]);
    run([ev({ type: 'npc_death', npcId: 'n_dead', lineageId: 'L', cause: 'age' }, 2)]);
    expect(ctx.store.bySubject({ kind: 'npc', npcId: 'n_kin' })).toHaveLength(1);
  });

  it('abandons an unanswered loss thread after the timeout', () => {
    run([ev({ type: 'npc_death', npcId: 'n_dead', lineageId: 'L', cause: 'age' })]);
    ctx.now = LOSS_ABANDON_TICKS + 1;
    recognizeLossGivenMeaning([], ctx); // event-independent sweep
    expect(ctx.store.bySubject({ kind: 'npc', npcId: 'n_kin' })[0].status).toBe('abandoned');
  });
});

describe('recognizeTrial', () => {
  it('a drought opens then settlement_end resolves a trial', () => {
    run([ev({ type: 'settlement_begin', poiId: 'p1', eventType: 'drought', severity: 0.5, durationTicks: 100 })]);
    expect(ctx.store.bySubject({ kind: 'settlement', poiId: 'p1' })[0].shapeId).toBe('trial');
    ctx.now = 50;
    run([ev({ type: 'settlement_end', poiId: 'p1', eventType: 'drought' }, 2)]);
    expect(ctx.store.bySubject({ kind: 'settlement', poiId: 'p1' })[0].status).toBe('resolved');
  });

  it('a festival does not open a trial', () => {
    run([ev({ type: 'settlement_begin', poiId: 'p2', eventType: 'festival', severity: 0.5, durationTicks: 100 })]);
    expect(ctx.store.bySubject({ kind: 'settlement', poiId: 'p2' })).toHaveLength(0);
  });

  it('a miracle is the turning point of an active trial', () => {
    run([ev({ type: 'settlement_begin', poiId: 'p3', eventType: 'plague', severity: 0.4, durationTicks: 100 })]);
    run([ev({ type: 'miracle', spiritId: 'player', poiId: 'p3', needType: 'safety', amount: 1 }, 2)]);
    expect(ctx.store.bySubject({ kind: 'settlement', poiId: 'p3' })[0].phase).toBe('turning');
  });
});
