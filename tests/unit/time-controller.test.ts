import { describe, it, expect, vi } from 'vitest';
import { TimeController, SEEK_CHUNK_SIM_MS } from '@/game/time-controller';
import { Scheduler, type System, type SystemContext } from '@/core/scheduler';
import { SimClock } from '@/core/clock';
import { EventLog, type SimEvent } from '@/core/events';
import { World } from '@/world/world';
import { createRng } from '@/core/rng';
import { createState, type GameState } from '@/core/state';
import { TICKS_PER_HOUR } from '@/core/calendar';
import { NpcMovementSystem } from '@/sim/systems/npc-movement-system';
import { NpcSimSystem } from '@/sim/systems/npc-sim-system';
import { SpiritSystem } from '@/sim/spirit-system';
import { PerceptionSystem } from '@/world/perception-system';
import { identityOracle } from '@/world/oracle';
import { initNpcProps } from '@/world/npc-helpers';
import type { GameMap, Tile } from '@/core/types';
import type { Spirit, SpiritId } from '@/core/spirit';

function gridMap(n = 20): GameMap {
  const tiles: Tile[][] = [];
  for (let y = 0; y < n; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < n; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
    tiles.push(row);
  }
  return { tiles, width: n, height: n, villages: [], seed: 1, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] } as unknown as GameMap;
}

/** A no-op 60 Hz system, so scheduler.tick has something to run. */
class NoopSystem implements System {
  readonly name = 'noop';
  readonly tickHz = 60;
  tick(): void { /* no-op */ }
}

/** Appends `ev` the first time the clock reaches `atTick` — used to plant a
 *  seek-stop event at a known sim time. */
class EmitAt implements System {
  readonly name: string;
  readonly tickHz = 60;
  private fired = false;
  constructor(private readonly atTick: number, private readonly ev: SimEvent, name = 'emit') { this.name = name; }
  tick(ctx: SystemContext): void {
    if (!this.fired && ctx.now >= this.atTick) { this.fired = true; ctx.log.append(this.ev); }
  }
}

function baseCtx(state: GameState) {
  return { world: state.world!, spirits: state.spirits, log: state.eventLog, clock: state.clock, rng: state.rng };
}

// ── Budget degradation ─────────────────────────────────────────────────────────

describe('TimeController — budgeted advance never freezes', () => {
  it('drops the remainder when the budget runs out (effective rate << requested)', () => {
    const state = createState();
    state.world = new World(gridMap());
    const sched = new Scheduler();
    sched.register(new NoopSystem());
    // Fake wall clock: every read advances 10 ms, so the ~24 ms budget is spent
    // after a couple of slices no matter how much sim was requested.
    let fake = 0;
    const now = () => { const v = fake; fake += 10; return v; };
    const tc = new TimeController({ scheduler: sched, clock: state.clock, eventLog: state.eventLog, state, now });

    tc.setRate(1000);                       // request a huge fast-forward
    tc.advance(100, baseCtx(state));        // desired = 100 ms × 1000 = 100 s of sim

    // A handful of 250 ms slices ran, NOT the full 100 s — the frame did not hang.
    expect(state.clock.now()).toBeGreaterThan(0);
    expect(state.clock.now()).toBeLessThan(200);          // « 100_000 ms / 16.667 ≈ 6000 ticks
    expect(tc.getEffectiveRate()).toBeLessThan(1000);     // degraded gracefully
  });

  it('rate ≤ 1 is a single tick, byte-identical to a direct scheduler.tick', () => {
    const build = () => {
      const state = createState();
      const map = gridMap();
      state.map = map;
      state.world = new World(map);
      state.world.addEntity({ id: 'n1', kind: 'npc', x: 10, y: 10, properties: initNpcProps('A', 'farmer', 42) as unknown as Record<string, unknown> });
      const sched = new Scheduler();
      sched.register(new NpcMovementSystem(() => state.map));
      sched.register(new NpcSimSystem());
      sched.register(new SpiritSystem());
      return { state, sched };
    };
    // Via TimeController at rate 1.
    const a = build();
    const atc = new TimeController({ scheduler: a.sched, clock: a.state.clock, eventLog: a.state.eventLog, state: a.state });
    atc.setRate(1);
    for (let i = 0; i < 40; i++) atc.advance(333, baseCtx(a.state));
    // Via a plain scheduler.tick loop.
    const b = build();
    b.sched.setRate(1);
    for (let i = 0; i < 40; i++) b.sched.tick(333, baseCtx(b.state));

    expect(a.state.clock.now()).toBe(b.state.clock.now());
    expect(a.state.rng.getState()).toEqual(b.state.rng.getState());
    expect(a.state.world!.registry.get('n1')!.x).toBe(b.state.world!.registry.get('n1')!.x);
    expect(a.state.world!.registry.get('n1')!.y).toBe(b.state.world!.registry.get('n1')!.y);
  });
});

// ── Determinism: budgeted fast-forward ≡ plain rate-1 loop over the same span ────

describe('TimeController — determinism (budgeted seek path ≡ plain rate-1)', () => {
  function makeState(seed: number): { state: GameState; sched: Scheduler; map: GameMap } {
    const state = createState();
    state.rng = createRng(seed) as unknown as GameState['rng'];
    const map = gridMap(24);
    state.map = map;
    state.world = new World(map);
    state.spirits = new Map<SpiritId, Spirit>([['player', {
      id: 'player', name: 'G', sigil: '⊙', color: '#fff', isPlayer: true, power: 5, manifestation: null,
    }]]);
    state.world.addEntity({ id: 'n1', kind: 'npc', x: 12, y: 12, properties: initNpcProps('A', 'farmer', 7) as unknown as Record<string, unknown> });
    state.world.addEntity({ id: 'n2', kind: 'npc', x: 8, y: 15, properties: initNpcProps('B', 'merchant', 99) as unknown as Record<string, unknown> });
    const sched = new Scheduler();
    sched.register(new NpcMovementSystem(() => state.map));
    sched.register(new NpcSimSystem());
    sched.register(new SpiritSystem());
    sched.register(new PerceptionSystem(identityOracle, () => state.map));
    return { state, sched, map };
  }

  it('same seed + budgeted advance produces the same world + event content as a rate-1 loop', () => {
    const TOTAL_SIM_MS = 120_000;   // 2 sim-minutes → 480 chunks of 250 ms
    const RATE = 1000;

    // Budgeted path: one advance call, huge rate, a now() that never trips the
    // budget so ALL slices run this frame.
    const a = makeState(31337);
    const atc = new TimeController({ scheduler: a.sched, clock: a.state.clock, eventLog: a.state.eventLog, state: a.state, now: () => 0 });
    atc.setRate(RATE);
    atc.advance(TOTAL_SIM_MS / RATE, baseCtx(a.state));   // desired = TOTAL_SIM_MS of sim

    // Reference: a plain rate-1 loop in the SAME 250 ms chunk size.
    const b = makeState(31337);
    b.sched.setRate(1);
    for (let i = 0; i < TOTAL_SIM_MS / 250; i++) b.sched.tick(250, baseCtx(b.state));

    expect(a.state.clock.now()).toBe(b.state.clock.now());
    expect(a.state.rng.getState()).toEqual(b.state.rng.getState());
    for (const id of ['n1', 'n2']) {
      expect(a.state.world!.registry.get(id)!.x).toBe(b.state.world!.registry.get(id)!.x);
      expect(a.state.world!.registry.get(id)!.y).toBe(b.state.world!.registry.get(id)!.y);
    }
    const evA = a.state.eventLog.since(0).map(e => JSON.stringify(e.event));
    const evB = b.state.eventLog.since(0).map(e => JSON.stringify(e.event));
    expect(evA).toEqual(evB);
  });
});

// ── Seek stop conditions + landing summary ──────────────────────────────────────

describe('TimeController — seek', () => {
  function seekHarness(planted?: { atTick: number; ev: SimEvent }, extra?: System) {
    const state = createState();
    state.world = new World(gridMap());
    const sched = new Scheduler();
    sched.register(new NoopSystem());
    if (extra) sched.register(extra);
    if (planted) sched.register(new EmitAt(planted.atTick, planted.ev, 'plant'));
    // now() = 0 always → the budget never trips, so a whole seek resolves in one
    // advance() call (each frame otherwise just carries it forward).
    const tc = new TimeController({ scheduler: sched, clock: state.clock, eventLog: state.eventLog, state, now: () => 0 });
    return { state, sched, tc };
  }

  it('lands on the first interesting event (predicate stop) and restores the pre-seek rate', () => {
    const ev: SimEvent = { type: 'thread_opened', threadId: 5, shapeId: 's' as never, subject: {} as never };
    const { state, tc } = seekHarness({ atTick: 300, ev });
    tc.setRate(2);                          // pre-seek rate
    const landed = vi.fn();
    tc.onLanded(landed);
    tc.requestSeek();
    tc.advance(16, baseCtx(state));         // resolves the whole seek (now()===0)

    expect(tc.isSeeking()).toBe(false);
    expect(landed).toHaveBeenCalledTimes(1);
    const summary = landed.mock.calls[0][0];
    expect(summary.quiet).toBe(false);
    expect(summary.trigger.event).toEqual(ev);
    expect(summary.toTick).toBeGreaterThanOrEqual(300);
    // Landed within one seek-chunk of the event (we can only stop at chunk edges).
    expect(summary.toTick).toBeLessThan(300 + SEEK_CHUNK_SIM_MS / 16.667 + 1);
    expect(tc.getRequestedRate()).toBe(2);  // restored
  });

  it('lands quiet at the horizon when nothing interesting happens', () => {
    const { state, tc } = seekHarness();
    const landed = vi.fn();
    tc.onLanded(landed);
    tc.requestSeek({ horizonHours: 1 });    // small horizon
    tc.advance(16, baseCtx(state));

    expect(tc.isSeeking()).toBe(false);
    const summary = landed.mock.calls[0][0];
    expect(summary.quiet).toBe(true);
    expect(summary.trigger).toBeNull();
    expect(summary.elapsedTicks).toBeGreaterThanOrEqual(TICKS_PER_HOUR);
  });

  it('cancelSeek lands immediately, quiet, and restores rate', () => {
    // now() advances so a single advance() only does a little, THEN we cancel.
    const state = createState();
    state.world = new World(gridMap());
    const sched = new Scheduler();
    sched.register(new NoopSystem());
    let fake = 0;
    const tc = new TimeController({ scheduler: sched, clock: state.clock, eventLog: state.eventLog, state, now: () => { const v = fake; fake += 10; return v; } });
    tc.setRate(1);
    const landed = vi.fn();
    tc.onLanded(landed);
    tc.requestSeek({ horizonHours: 999 });
    tc.advance(16, baseCtx(state));         // advances a little (budget-bounded)
    expect(tc.isSeeking()).toBe(true);      // horizon far off, still seeking
    tc.cancelSeek();

    expect(tc.isSeeking()).toBe(false);
    expect(landed).toHaveBeenCalledTimes(1);
    const summary = landed.mock.calls[0][0];
    expect(summary.quiet).toBe(true);
    expect(summary.trigger).toBeNull();
    expect(tc.getRequestedRate()).toBe(1);
  });

  it('passedCounts tallies every event kind seen during the seek', () => {
    // Plant a non-interesting spawn at tick 100 and an interesting thread at 300.
    const spawn: SimEvent = { type: 'npc_spawn', npcId: 'x', role: 'farmer' as never, poiId: 'p' };
    const thread: SimEvent = { type: 'thread_opened', threadId: 1, shapeId: 's' as never, subject: {} as never };
    const state = createState();
    state.world = new World(gridMap());
    const sched = new Scheduler();
    sched.register(new NoopSystem());
    sched.register(new EmitAt(100, spawn, 'spawn'));
    sched.register(new EmitAt(300, thread, 'thread'));
    const tc = new TimeController({ scheduler: sched, clock: state.clock, eventLog: state.eventLog, state, now: () => 0 });
    const landed = vi.fn();
    tc.onLanded(landed);
    tc.requestSeek();
    tc.advance(16, baseCtx(state));

    const summary = landed.mock.calls[0][0];
    expect(summary.passedCounts['npc_spawn']).toBe(1);
    expect(summary.passedCounts['thread_opened']).toBe(1);
    expect(summary.trigger.event).toEqual(thread);   // landed on the interesting one
  });
});
