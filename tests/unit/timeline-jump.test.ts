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

function attachWorld(state: ReturnType<typeof createState>): GameMap {
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
  const props = initNpcProps('Alice', 'farmer', 42);
  state.world.addEntity({ id: 'n1', kind: 'npc', x: 10, y: 10, properties: props as unknown as Record<string, unknown> });
  return map;
}

function buildScheduler(getMap: () => GameMap | null): Scheduler {
  const sched = new Scheduler();
  sched.register(new NpcMovementSystem(getMap));
  sched.register(new NpcSimSystem());
  sched.register(new SpiritSystem());
  sched.register(new PerceptionSystem(identityOracle, getMap));
  return sched;
}

describe('TimelineController.jumpTo / returnToLive', () => {
  it('jumpTo rewinds using the nearest snapshot + silent forward run', () => {
    const state = createState();
    attachWorld(state);
    const sched = buildScheduler(() => state.map);
    const tl = new TimelineController({ state, scheduler: sched, snapshotEveryNEvents: 50 });

    for (let i = 0; i < 90; i++) {
      sched.tick(333, { world: state.world!, spirits: state.spirits, log: state.eventLog, clock: state.clock, rng: state.rng });
      tl.onAfterLiveTick();
    }
    const liveTick = state.clock.now();

    tl.jumpTo(Math.floor(liveTick / 2));
    expect(tl.isScrubbed).toBe(true);
    expect(state.clock.now()).toBeLessThanOrEqual(liveTick / 2 + 1);

    tl.returnToLive();
    expect(tl.isScrubbed).toBe(false);
    expect(state.clock.now()).toBe(liveTick);
  });
});
