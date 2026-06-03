import { describe, it, expect } from 'vitest';
import { createState } from '@/core/state';
import { TimelineController } from '@/core/timeline';
import { Scheduler } from '@/core/scheduler';
import { CommandQueue } from '@/sim/command/command-queue';
import { CommandExecutorSystem } from '@/sim/command/command-system';
import { RivalSystem } from '@/sim/systems/rival-system';
import { NpcMovementSystem } from '@/sim/systems/npc-movement-system';
import { NpcSimSystem } from '@/sim/systems/npc-sim-system';
import { SpiritSystem } from '@/sim/spirit-system';
import { World } from '@/world/world';
import { initNpcProps } from '@/world/npc-helpers';
import type { GameMap, Tile, NpcProperties } from '@/core/types';
import type { Spirit } from '@/core/spirit';

function attach(state: ReturnType<typeof createState>) {
  const tiles: Tile[][] = [];
  for (let y = 0; y < 12; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < 12; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
    tiles.push(row);
  }
  const map: GameMap = {
    tiles, width: 12, height: 12, villages: [], seed: 1, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [],
  };
  state.map = map;
  state.world = new World(map);
  const props = initNpcProps('A', 'farmer', 42) as unknown as NpcProperties;
  props.homePoiId = 'poi1';
  state.world.addEntity({ id: 'n1', kind: 'npc', x: 6, y: 6, properties: props as unknown as Record<string, unknown> });

  // A funded rival that claims poi1 and acts often.
  const rival: Spirit = {
    id: 'rival-1', name: 'Sablethorn', sigil: '◆', color: '#a0f', isPlayer: false, power: 50, manifestation: null,
    ai: {
      policy: 'coexist', cooldowns: {},
      personality: { aggression: 0.2, subtlety: 0.5, territoriality: 0.5, assertiveness: 0.3, jealousy: 0.3 },
      settlements: ['poi1'], lastActionTick: 0, actionCooldown: 2,
    },
  };
  state.spirits.set('rival-1', rival);
}

function rivalFaith(state: ReturnType<typeof createState>): number | undefined {
  const p = state.world!.registry.get('n1')!.properties as unknown as NpcProperties;
  return p.beliefs['rival-1']?.faith;
}

describe('Timeline replay equivalence — rivals through the command channel', () => {
  it('jumpTo + replay reproduces rival-driven belief byte-identically', () => {
    const state = createState();
    attach(state);
    const queue = new CommandQueue();
    const sched = new Scheduler();
    // Executor first (matches game.ts), then sim systems, then the rival emitter.
    sched.register(new CommandExecutorSystem(queue));
    sched.register(new NpcMovementSystem(() => state.map));
    sched.register(new NpcSimSystem());
    sched.register(new SpiritSystem());
    sched.register(new RivalSystem(queue));
    const tl = new TimelineController({ state, scheduler: sched, onRestore: () => queue.clear() });

    for (let i = 0; i < 90; i++) {
      sched.tick(333, { world: state.world!, spirits: state.spirits, log: state.eventLog, clock: state.clock, rng: state.rng });
      tl.onAfterLiveTick();
    }

    const liveTick = state.clock.now();
    const liveFaith = rivalFaith(state);
    const liveRng = state.rng.getState();
    const liveRivalPower = state.spirits.get('rival-1')!.power;

    // Scrub back (restore snapshot + silent replay forward), then return to live.
    tl.jumpTo(Math.floor(liveTick / 3));
    tl.jumpTo(liveTick);
    tl.returnToLive();

    expect(state.clock.now()).toBe(liveTick);
    expect(rivalFaith(state)).toBe(liveFaith);
    expect(state.rng.getState()).toEqual(liveRng);
    expect(state.spirits.get('rival-1')!.power).toBe(liveRivalPower);
  });

  it('the rival actually acted (non-vacuous): it spent power and recruited the NPC', () => {
    const state = createState();
    attach(state);
    const queue = new CommandQueue();
    const sched = new Scheduler();
    sched.register(new CommandExecutorSystem(queue));
    sched.register(new NpcMovementSystem(() => state.map));
    sched.register(new NpcSimSystem());
    sched.register(new SpiritSystem());
    sched.register(new RivalSystem(queue));

    for (let i = 0; i < 90; i++) {
      sched.tick(333, { world: state.world!, spirits: state.spirits, log: state.eventLog, clock: state.clock, rng: state.rng });
    }
    // Over ~30s of sim the coexist rival should have whispered at least once.
    expect(rivalFaith(state)).toBeGreaterThan(0);
  });
});
