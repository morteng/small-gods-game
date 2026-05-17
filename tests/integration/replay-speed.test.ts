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

describe('replay speed budget', () => {
  it('jumpTo + returnToLive completes in < 200ms after 500 live ticks', () => {
    const state = createState();
    const tiles: Tile[][] = [];
    for (let y = 0; y < 30; y++) {
      const row: Tile[] = [];
      for (let x = 0; x < 30; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
      tiles.push(row);
    }
    const map: GameMap = {
      tiles, width: 30, height: 30, villages: [], seed: 1, success: true,
      worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [],
    };
    state.map = map;
    state.world = new World(map);
    for (let i = 0; i < 20; i++) {
      state.world.addEntity({
        id: `n${i}`, kind: 'npc', x: i, y: i,
        properties: initNpcProps(`n${i}`, 'farmer', 30) as unknown as Record<string, unknown>,
      });
    }
    const sched = new Scheduler();
    sched.register(new NpcMovementSystem(() => state.map));
    sched.register(new NpcSimSystem());
    sched.register(new SpiritSystem());
    sched.register(new PerceptionSystem(identityOracle, () => state.map));
    const tl = new TimelineController({ state, scheduler: sched });

    for (let i = 0; i < 500; i++) {
      sched.tick(16, { world: state.world!, spirits: state.spirits, log: state.eventLog, clock: state.clock, rng: state.rng });
      tl.onAfterLiveTick();
    }

    const t0 = performance.now();
    tl.jumpTo(Math.floor(state.clock.now() / 2));
    tl.returnToLive();
    const elapsed = performance.now() - t0;

    expect(elapsed).toBeLessThan(200);
  });
});
