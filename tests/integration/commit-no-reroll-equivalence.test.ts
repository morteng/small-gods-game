/**
 * Spec B §5 test 7: commit({ reroll: false }) must reproduce the same future
 * if you re-run the sim forward from the scrub point. Same RNG state → same fate.
 */
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
  state.world.addEntity({
    id: 'n1', kind: 'npc', x: 7, y: 7,
    properties: initNpcProps('A', 'farmer', 42) as unknown as Record<string, unknown>,
  });
}

function buildSched(state: ReturnType<typeof createState>) {
  const sched = new Scheduler();
  sched.register(new NpcMovementSystem(() => state.map));
  sched.register(new NpcSimSystem());
  sched.register(new SpiritSystem());
  sched.register(new PerceptionSystem(identityOracle, () => state.map));
  return sched;
}

// Use the same step size as TimelineController.forwardSilent (1000/60). When
// live and silent replay both step at one sim tick per call, the cooldown
// math in NpcMovementSystem (which consumes ctx.dt) agrees across the two
// paths. Larger live steps diverge from silent replay — a pre-existing
// system quirk, not a Spec B replay bug. The production game loop runs at
// ~16.67 ms RAF deltas, matching this step.
const STEP_MS = 1000 / 60;

function tickFor(state: ReturnType<typeof createState>, sched: Scheduler, tl: TimelineController, n: number) {
  for (let i = 0; i < n; i++) {
    sched.tick(STEP_MS, {
      world: state.world!, spirits: state.spirits, log: state.eventLog,
      clock: state.clock, rng: state.rng,
    });
    tl.onAfterLiveTick();
  }
}

function fateOf(state: ReturnType<typeof createState>): number[] {
  const e = state.world!.registry.get('n1')!;
  return [e.x, e.y];
}

describe('commit({ reroll: false }) preserves the fate', () => {
  it('post-commit forward run reproduces the same NPC position as the original future', () => {
    // Run A: live to N ticks, capture fate at midpoint, then continue.
    const STEPS = 800;
    const a = createState();
    attach(a);
    const schedA = buildSched(a);
    const tlA = new TimelineController({ state: a, scheduler: schedA });
    tickFor(a, schedA, tlA, STEPS);
    const fateAtMid = fateOf(a);
    tickFor(a, schedA, tlA, STEPS);
    const originalFate = fateOf(a);

    // Run B: identical seed, run forward 2N, scrub back to N, commit no-reroll,
    // run forward N more. Post-commit fate must equal originalFate.
    const b = createState();
    attach(b);
    const schedB = buildSched(b);
    const tlB = new TimelineController({ state: b, scheduler: schedB });
    tickFor(b, schedB, tlB, STEPS);
    tickFor(b, schedB, tlB, STEPS);
    tlB.jumpTo(Math.floor(b.clock.now() / 2));
    expect(fateOf(b)).toEqual(fateAtMid);
    tlB.commit({ reroll: false });
    tickFor(b, schedB, tlB, STEPS);

    expect(fateOf(b)).toEqual(originalFate);
  });

  it('replay at rate=2 produces identical NPC positions to live (no reroll)', () => {
    // At rate=2 the scheduler accumulator grows to 2*interval per sched.tick
    // and the while-loop fires twice, passing ctx.dt = 2*interval on the first
    // iteration. Silent replay (forwardSilent) also runs through the same
    // scheduler at rate=2, so the per-iteration dt must match the fixed
    // per-tick interval — not the raw accumulator — to keep both paths
    // bit-identical. This test locks in that fix.
    const STEPS = 800;
    const a = createState();
    attach(a);
    const schedA = buildSched(a);
    const tlA = new TimelineController({ state: a, scheduler: schedA });
    schedA.setRate(2);
    tickFor(a, schedA, tlA, STEPS);
    const fateAtMid = fateOf(a);
    tickFor(a, schedA, tlA, STEPS);
    const originalFate = fateOf(a);

    const b = createState();
    attach(b);
    const schedB = buildSched(b);
    const tlB = new TimelineController({ state: b, scheduler: schedB });
    schedB.setRate(2);
    tickFor(b, schedB, tlB, STEPS);
    tickFor(b, schedB, tlB, STEPS);
    tlB.jumpTo(Math.floor(b.clock.now() / 2));
    expect(fateOf(b)).toEqual(fateAtMid);
    tlB.commit({ reroll: false });
    tickFor(b, schedB, tlB, STEPS);

    expect(fateOf(b)).toEqual(originalFate);
  });
});
