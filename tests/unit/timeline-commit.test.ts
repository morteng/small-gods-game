import { describe, it, expect } from 'vitest';
import { createState } from '@/core/state';
import { TimelineController } from '@/core/timeline';
import { Scheduler } from '@/core/scheduler';
import { NpcMovementSystem } from '@/sim/systems/npc-movement-system';
import { NpcSimSystem } from '@/sim/systems/npc-sim-system';
import { SpiritSystem } from '@/sim/spirit-system';
import { PerceptionSystem } from '@/world/perception-system';
import { identityOracle } from '@/world/oracle';
import { World } from '@/world/world';
import { initNpcProps } from '@/world/npc-helpers';
import type { GameMap, Tile } from '@/core/types';

function attachWorld(state: ReturnType<typeof createState>) {
  const tiles: Tile[][] = [];
  for (let y = 0; y < 20; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < 20; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
    tiles.push(row);
  }
  const map: GameMap = {
    tiles, width: 20, height: 20, villages: [], seed: 1, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [],
  };
  state.map = map;
  state.world = new World(map);
  state.world.addEntity({ id: 'n1', kind: 'npc', x: 10, y: 10, properties: initNpcProps('A', 'farmer', 42) as unknown as Record<string, unknown> });
}

function buildSched(state: ReturnType<typeof createState>) {
  const sched = new Scheduler();
  sched.register(new NpcMovementSystem(() => state.map));
  sched.register(new NpcSimSystem());
  sched.register(new SpiritSystem());
  sched.register(new PerceptionSystem(identityOracle, () => state.map));
  return sched;
}

function tickFor(state: ReturnType<typeof createState>, sched: Scheduler, tl: TimelineController, n: number) {
  for (let i = 0; i < n; i++) {
    sched.tick(333, { world: state.world!, spirits: state.spirits, log: state.eventLog, clock: state.clock, rng: state.rng });
    tl.onAfterLiveTick();
  }
}

describe('TimelineController.commit', () => {
  it('commit with reroll=false truncates events after the scrub tick', () => {
    const state = createState();
    attachWorld(state);
    const sched = buildSched(state);
    const tl = new TimelineController({ state, scheduler: sched });

    tickFor(state, sched, tl, 60);
    const midTick = state.clock.now();
    tickFor(state, sched, tl, 30);

    tl.jumpTo(midTick);
    tl.commit({ reroll: false });
    const tails = state.eventLog.since(0).filter(e => e.t > midTick);
    expect(tails.length).toBe(0);
    expect(tl.isScrubbed).toBe(false);
  });

  it('commit with reroll=true changes the rng state', () => {
    const state = createState();
    attachWorld(state);
    const sched = buildSched(state);
    const tl = new TimelineController({ state, scheduler: sched });

    tickFor(state, sched, tl, 60);
    const midTick = state.clock.now();
    tickFor(state, sched, tl, 30);

    tl.jumpTo(midTick);
    const rngBefore = state.rng.getState();
    tl.commit({ reroll: true });
    const rngAfter = state.rng.getState();
    expect(rngAfter).not.toEqual(rngBefore);
  });

  it('discarded futures are retained for Spec C', () => {
    const state = createState();
    attachWorld(state);
    const sched = buildSched(state);
    const tl = new TimelineController({ state, scheduler: sched });

    tickFor(state, sched, tl, 60);
    const midTick = state.clock.now();
    tickFor(state, sched, tl, 30);

    tl.jumpTo(midTick);
    tl.commit({ reroll: false });
    const futures = tl.getDiscardedFutures();
    expect(futures.length).toBe(1);
    expect(futures[0].parentTick).toBe(midTick);
    expect(futures[0].rerolled).toBe(false);
  });

  it('appends a timeline_commit event at the cutoff tick when committing without reroll', () => {
    const state = createState();
    attachWorld(state);
    const sched = buildSched(state);
    const tl = new TimelineController({ state, scheduler: sched });

    tickFor(state, sched, tl, 60);
    const midTick = state.clock.now();
    tickFor(state, sched, tl, 30);

    tl.jumpTo(midTick);
    tl.commit({ reroll: false });

    const commitEvents = state.eventLog.since(0).filter(e => e.event.type === 'timeline_commit');
    expect(commitEvents).toHaveLength(1);
    expect(commitEvents[0].t).toBe(midTick);
    const ev = commitEvents[0].event;
    if (ev.type !== 'timeline_commit') throw new Error('unexpected event type');
    expect(ev.parentTick).toBe(midTick);
    expect(ev.rerolled).toBe(false);
  });

  it('records rerolled: true when committing with reroll', () => {
    const state = createState();
    attachWorld(state);
    const sched = buildSched(state);
    const tl = new TimelineController({ state, scheduler: sched });

    tickFor(state, sched, tl, 60);
    const midTick = state.clock.now();
    tickFor(state, sched, tl, 30);

    tl.jumpTo(midTick);
    tl.commit({ reroll: true });

    const events = state.eventLog.since(0);
    const last = events[events.length - 1];
    expect(last.t).toBe(midTick);
    const ev = last.event;
    if (ev.type !== 'timeline_commit') throw new Error('unexpected event type');
    expect(ev.rerolled).toBe(true);
  });
});
