import { describe, it, expect } from 'vitest';
import { Scheduler } from '@/core/scheduler';
import { CommandQueue } from '@/sim/command/command-queue';
import { CommandExecutorSystem } from '@/sim/command/command-system';
import { AuthorCommandLog } from '@/sim/command/author-command-log';
import { TimelineController } from '@/core/timeline';
import { World } from '@/world/world';
import { SimClock } from '@/core/clock';
import { EventLog } from '@/core/events';
import { createRng } from '@/core/rng';
import { initNpcProps, queryNpcs } from '@/world/npc-helpers';
import type { GameState } from '@/core/state';
import type { GameMap, Entity } from '@/core/types';
import type { Spirit, SpiritId } from '@/core/spirit';

function realizedMap(n = 12): GameMap {
  const tiles: GameMap['tiles'] = [];
  for (let y = 0; y < n; y++) {
    const row = [];
    for (let x = 0; x < n; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
    tiles.push(row as never);
  }
  return { tiles, width: n, height: n, villages: [], seed: 1, success: true, worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] } as unknown as GameMap;
}

function anchorNpc(): Entity {
  const p = initNpcProps('anchor', 'farmer', 7);
  p.homePoiId = 'poi1'; p.homeX = 6; p.homeY = 6;
  return { id: 'anchor', kind: 'npc', x: 6, y: 6, properties: p as unknown as Record<string, unknown> };
}

function setup() {
  const clock = new SimClock();
  const map = realizedMap();
  const world = new World(map);
  world.addEntity(anchorNpc());
  const spirits = new Map<SpiritId, Spirit>([['player', { id: 'player', name: 'You', sigil: '✦', color: '#fff', isPlayer: true, power: 100, manifestation: null }]]);
  const eventLog = new EventLog(clock);
  const state = { clock, map, world, spirits, eventLog, rng: createRng(999) } as unknown as GameState;

  const queue = new CommandQueue();
  const authorLog = new AuthorCommandLog();
  const scheduler = new Scheduler();
  scheduler.register(new CommandExecutorSystem(queue, undefined, authorLog)); // FIRST

  const timeline = new TimelineController({
    state, scheduler, snapshotEveryNEvents: 1, authorLog,
    onRestore: () => queue.clear(),
  });

  const STEP = 1000 / 60;
  const baseCtx = () => ({ world: state.world!, spirits: state.spirits, log: state.eventLog, clock: state.clock, rng: state.rng });
  const liveTick = () => { scheduler.tick(STEP, baseCtx()); timeline.onAfterLiveTick(); };

  return { state, queue, authorLog, scheduler, timeline, liveTick };
}

describe('author edit replay parity', () => {
  it('a spawned cohort disappears when scrubbed before the edit and reappears identically when scrubbed past it', () => {
    const { state, queue, timeline, liveTick } = setup();

    for (let i = 0; i < 5; i++) liveTick();
    const spawnTick = state.clock.now();

    queue.emit({ verb: 'author_spawn_npc', source: 'author', target: { kind: 'none' }, payload: { role: 'farmer', count: 2, near: 'poi1' } });
    liveTick(); // applies the spawn at spawnTick (+1 step)
    const afterTick = state.clock.now();

    const liveIds = queryNpcs(state.world!).map(e => e.id).sort();
    expect(liveIds.length).toBe(3); // anchor + 2

    for (let i = 0; i < 5; i++) liveTick();

    // Scrub BEFORE the spawn → only the anchor exists.
    timeline.jumpTo(spawnTick - 1);
    expect(queryNpcs(state.world!).map(e => e.id)).toEqual(['anchor']);

    // Scrub PAST the spawn → the cohort reappears with identical ids.
    timeline.jumpTo(afterTick);
    expect(queryNpcs(state.world!).map(e => e.id).sort()).toEqual(liveIds);
  });
});
