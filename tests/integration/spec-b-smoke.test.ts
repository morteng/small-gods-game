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
import { whisper } from '@/sim/whisper';
import type { GameMap, Tile } from '@/core/types';

describe('Spec B smoke', () => {
  it('scrub → re-roll changes the future', () => {
    const state = createState();
    const tiles: Tile[][] = [];
    for (let y = 0; y < 15; y++) {
      const row: Tile[] = [];
      for (let x = 0; x < 15; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
      tiles.push(row);
    }
    const map: GameMap = {
      tiles, width: 15, height: 15, villages: [], seed: 1, success: true,
      worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [],
    };
    state.map = map;
    state.world = new World(map);
    state.world.addEntity({ id: 'n1', kind: 'npc', x: 7, y: 7, properties: initNpcProps('A', 'farmer', 42) as unknown as Record<string, unknown> });

    const sched = new Scheduler();
    sched.register(new NpcMovementSystem(() => state.map));
    sched.register(new NpcSimSystem());
    sched.register(new SpiritSystem());
    sched.register(new PerceptionSystem(identityOracle, () => state.map));
    const tl = new TimelineController({ state, scheduler: sched });

    const tickFor = (n: number) => {
      for (let i = 0; i < n; i++) {
        sched.tick(333, { world: state.world!, spirits: state.spirits, log: state.eventLog, clock: state.clock, rng: state.rng });
        tl.onAfterLiveTick();
      }
    };

    tickFor(60);
    const midTick = state.clock.now();
    whisper(state.spirits.get('player')!, state.world.registry.get('n1')!, state.eventLog);
    tickFor(60);
    const fateA = state.world.registry.get('n1')!.x + state.world.registry.get('n1')!.y;

    tl.jumpTo(midTick);
    tl.commit({ reroll: true });
    tickFor(60);
    const fateB = state.world.registry.get('n1')!.x + state.world.registry.get('n1')!.y;

    expect(fateA).not.toBe(fateB);
  });
});
