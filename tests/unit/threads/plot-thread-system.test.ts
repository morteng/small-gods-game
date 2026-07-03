import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import { initNpcProps } from '@/world/npc-helpers';
import { EventLog, type AppendedEvent } from '@/core/events';
import { SimClock } from '@/core/clock';
import { createRng } from '@/core/rng';
import { PlotThreadStore } from '@/sim/threads/thread-store';
import { StagingBuffer } from '@/sim/threads/staging-buffer';
import { PlotThreadSystem } from '@/sim/threads/systems/plot-thread-system';
import { StoryRegistry } from '@/story/story-registry';
import { STORY_IR_VERSION } from '@/story/story-ir';
import type { SystemContext } from '@/core/scheduler';
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
function props(over: Partial<NpcProperties>): Record<string, unknown> {
  return { ...initNpcProps('x', 'farmer', 1), ...over } as unknown as Record<string, unknown>;
}

describe('PlotThreadSystem', () => {
  it('runs recognizers and emits thread_opened for events in the log', () => {
    const clock = new SimClock();
    const log = new EventLog(clock);
    const world = new World(makeMap());
    world.addEntity({ id: 'dead', kind: 'remains', x: 1, y: 1,
      properties: props({ lineageId: 'L', beliefs: { player: { faith: 0.6, understanding: 0.3, devotion: 0.4 } } }) });
    world.addEntity({ id: 'kin', kind: 'npc', x: 2, y: 2,
      properties: props({ lineageId: 'L', relationships: [{ npcId: 'dead', type: 'family', trust: 0.9 }] }) });

    const store = new PlotThreadStore();
    const captured: AppendedEvent[] = [];
    log.subscribe(e => captured.push(e));
    log.append({ type: 'npc_death', npcId: 'dead', lineageId: 'L', cause: 'age' });

    const sys = new PlotThreadSystem(() => store);
    const ctx: SystemContext = {
      world, spirits: new Map(), log, clock, rng: createRng(1), dt: 2000, now: clock.now(),
    };
    sys.tick(ctx);

    expect(store.active().some(t => t.shapeId === 'loss-given-meaning')).toBe(true);
    expect(captured.some(e => e.event.type === 'thread_opened')).toBe(true);
  });

  it('advances its cursor so it does not reprocess old events', () => {
    const clock = new SimClock();
    const log = new EventLog(clock);
    const world = new World(makeMap());
    const store = new PlotThreadStore();
    const sys = new PlotThreadSystem(() => store);
    const ctx: SystemContext = { world, spirits: new Map(), log, clock, rng: createRng(1), dt: 2000, now: 0 };

    log.append({ type: 'settlement_begin', poiId: 'p1', eventType: 'drought', severity: 0.5, durationTicks: 100 });
    sys.tick(ctx);
    expect(store.active()).toHaveLength(1);
    sys.tick(ctx); // second tick, no new events
    expect(store.active()).toHaveLength(1); // not duplicated
  });
});

function gateCtx(log: EventLog, clock: SimClock): SystemContext {
  return { world: new World(makeMap()), spirits: new Map(), log, clock, rng: createRng(1), dt: 2000, now: 10 };
}

describe('PlotThreadSystem producer gate', () => {
  it('does NOT run stub producers when isProducerActive returns false', () => {
    const clock = new SimClock();
    const log = new EventLog(clock);
    const threads = new PlotThreadStore();
    const staging = new StagingBuffer();
    // A trial thread parked at `hardship` is exactly what the stub producer arms on.
    const t = threads.open('trial', { kind: 'settlement', poiId: 'p1' }, 0);
    threads.advance(t.id, 'hardship', 1, 0);
    const sys = new PlotThreadSystem(() => threads, () => staging, () => false);
    sys.tick(gateCtx(log, clock));
    expect(staging.armedByTrigger('discovery')).toHaveLength(0);
  });

  it('DOES run stub producers when the gate is absent (default) or true', () => {
    const clock = new SimClock();
    const log = new EventLog(clock);
    const threads = new PlotThreadStore();
    const staging = new StagingBuffer();
    const t = threads.open('trial', { kind: 'settlement', poiId: 'p1' }, 0);
    threads.advance(t.id, 'hardship', 1, 0);
    const sys = new PlotThreadSystem(() => threads, () => staging); // no gate ⇒ default on
    sys.tick(gateCtx(log, clock));
    expect(staging.armedByTrigger('discovery').length).toBeGreaterThan(0);
  });

  it('forwards a loaded StoryRegistry into the stub producer, arming a storylet ref', () => {
    const clock = new SimClock();
    const log = new EventLog(clock);
    const threads = new PlotThreadStore();
    const staging = new StagingBuffer();
    const t = threads.open('trial', { kind: 'settlement', poiId: 'p1' }, 0);
    threads.advance(t.id, 'hardship', 1, 0);

    const registry = new StoryRegistry();
    expect(registry.register({
      id: 'pack', version: STORY_IR_VERSION,
      storylets: [{ id: 'entry', priority: 5, body: [{ t: 'end' }] }],
    })).toEqual([]);

    const sys = new PlotThreadSystem(() => threads, () => staging, () => true, () => registry);
    sys.tick(gateCtx(log, clock));
    const beats = staging.armedByTrigger('discovery');
    expect(beats).toHaveLength(1);
    expect(beats[0].storylet).toBe('entry');
  });
});
