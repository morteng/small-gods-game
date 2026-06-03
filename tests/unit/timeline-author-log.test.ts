import { describe, it, expect } from 'vitest';
import { createState } from '@/core/state';
import { TimelineController } from '@/core/timeline';
import { Scheduler } from '@/core/scheduler';
import { NpcSimSystem } from '@/sim/systems/npc-sim-system';
import { World } from '@/world/world';
import { initNpcProps } from '@/world/npc-helpers';
import { AuthorCommandLog } from '@/sim/command/author-command-log';
import type { Command } from '@/sim/command/types';
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

function tickFor(state: ReturnType<typeof createState>, sched: Scheduler, tl: TimelineController, n: number) {
  for (let i = 0; i < n; i++) {
    sched.tick(333, { world: state.world!, spirits: state.spirits, log: state.eventLog, clock: state.clock, rng: state.rng });
    tl.onAfterLiveTick();
  }
}

function authorCmd(): Command {
  return { verb: 'author_remove_entity', source: 'author', target: { kind: 'none' }, payload: {}, seq: 0 };
}

describe('TimelineController + AuthorCommandLog', () => {
  it('truncates the author command log on commit at the cutoff tick', () => {
    const state = createState();
    attachWorld(state);
    const sched = new Scheduler();
    sched.register(new NpcSimSystem());
    const authorLog = new AuthorCommandLog();
    const tl = new TimelineController({ state, scheduler: sched, authorLog });

    tickFor(state, sched, tl, 60);
    const midTick = state.clock.now();
    // record an author command at the mid tick and at a later tick
    authorLog.record(midTick, authorCmd());
    tickFor(state, sched, tl, 30);
    authorLog.record(state.clock.now(), authorCmd());
    expect(authorLog.size()).toBe(2);

    tl.jumpTo(midTick);
    tl.commit({ reroll: false });

    // only the entry at/<= the cutoff survives
    expect(authorLog.all().map(e => e.tick)).toEqual([midTick]);
  });

  it('resets the author command log on commitSkip', () => {
    const state = createState();
    attachWorld(state);
    const sched = new Scheduler();
    sched.register(new NpcSimSystem());
    const authorLog = new AuthorCommandLog();
    const tl = new TimelineController({ state, scheduler: sched, authorLog });

    tickFor(state, sched, tl, 30);
    authorLog.record(state.clock.now(), authorCmd());
    expect(authorLog.size()).toBe(1);

    tl.commitSkip();
    expect(authorLog.size()).toBe(0);
  });
});
