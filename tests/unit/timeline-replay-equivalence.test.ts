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

function attach(state: ReturnType<typeof createState>) {
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
}

describe('Timeline replay equivalence', () => {
  it('jumpTo + returnToLive leaves world state byte-identical', () => {
    const state = createState();
    attach(state);
    const sched = new Scheduler();
    sched.register(new NpcMovementSystem(() => state.map));
    sched.register(new NpcSimSystem());
    sched.register(new SpiritSystem());
    sched.register(new PerceptionSystem(identityOracle, () => state.map));
    const tl = new TimelineController({ state, scheduler: sched });

    for (let i = 0; i < 90; i++) {
      sched.tick(333, { world: state.world!, spirits: state.spirits, log: state.eventLog, clock: state.clock, rng: state.rng });
      tl.onAfterLiveTick();
    }
    const liveTick = state.clock.now();
    const liveX = state.world!.registry.get('n1')!.x;
    const liveY = state.world!.registry.get('n1')!.y;
    const liveRng = state.rng.getState();
    const liveEvents = state.eventLog.size();

    tl.jumpTo(Math.floor(liveTick / 3));
    tl.returnToLive();

    expect(state.clock.now()).toBe(liveTick);
    expect(state.world!.registry.get('n1')!.x).toBe(liveX);
    expect(state.world!.registry.get('n1')!.y).toBe(liveY);
    expect(state.rng.getState()).toEqual(liveRng);
    expect(state.eventLog.size()).toBe(liveEvents);
  });
});
