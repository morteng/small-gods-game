import { describe, it, expect, vi } from 'vitest';
import { Scheduler, type System, type SystemContext } from '@/core/scheduler';
import { SimClock } from '@/core/clock';
import { EventLog } from '@/core/events';
import { World } from '@/world/world';
import { createRng } from '@/core/rng';
import type { GameMap } from '@/core/types';

function makeMap(): GameMap {
  return {
    tiles: [], width: 0, height: 0, villages: [], seed: 1,
    success: true, worldSeed: null,
    stats: { iterations: 0, backtracks: 0 }, buildings: [],
  };
}

function makeCtx(): Omit<SystemContext, 'dt' | 'now'> {
  const clock = new SimClock();
  return {
    world: new World(makeMap()),
    spirits: new Map(),
    log: new EventLog(clock),
    clock,
    rng: createRng(0),
  };
}

describe('Scheduler', () => {
  it('registers and ticks a single system at its rate', () => {
    const sched = new Scheduler();
    const fn = vi.fn();
    sched.register({ name: 's', tickHz: 1, tick: fn });  // 1 Hz → 1000 ms / tick
    const ctx = makeCtx();
    sched.tick(500, ctx);   // half an interval
    expect(fn).not.toHaveBeenCalled();
    sched.tick(500, ctx);   // crosses 1000 ms threshold
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('keeps accumulator across calls — fast systems fire multiple times if dt is large', () => {
    const sched = new Scheduler();
    const fn = vi.fn();
    sched.register({ name: 's', tickHz: 60, tick: fn });
    const ctx = makeCtx();
    sched.tick(50, ctx);   // 60Hz = 16.667 ms/tick; 50 ms → 2 ticks
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does not tick systems with tickHz <= 0', () => {
    const sched = new Scheduler();
    const fn = vi.fn();
    sched.register({ name: 's', tickHz: 0, tick: fn });
    const ctx = makeCtx();
    sched.tick(10_000, ctx);
    expect(fn).not.toHaveBeenCalled();
  });

  it('rejects duplicate system names', () => {
    const sched = new Scheduler();
    sched.register({ name: 's', tickHz: 1, tick: () => {} });
    expect(() => sched.register({ name: 's', tickHz: 1, tick: () => {} }))
      .toThrowError(/already registered/);
  });

  it('a throwing system does not stop others and emits system_error', () => {
    const sched = new Scheduler();
    const good = vi.fn();
    sched.register({ name: 'bad', tickHz: 1, tick: () => { throw new Error('boom'); } });
    sched.register({ name: 'good', tickHz: 1, tick: good });
    const ctx = makeCtx();
    sched.tick(1000, ctx);
    expect(good).toHaveBeenCalledTimes(1);
    const evts = ctx.log.since(0);
    expect(evts).toHaveLength(1);
    expect(evts[0].event).toMatchObject({ type: 'system_error', system: 'bad' });
  });

  it('setRate scales sim time', () => {
    const sched = new Scheduler();
    const fn = vi.fn();
    sched.register({ name: 's', tickHz: 1, tick: fn });
    sched.setRate(2);
    const ctx = makeCtx();
    sched.tick(500, ctx);   // real 500ms × 2 = sim 1000ms → tick
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('setRate(0) pauses sim time', () => {
    const sched = new Scheduler();
    const fn = vi.fn();
    sched.register({ name: 's', tickHz: 1, tick: fn });
    sched.setRate(0);
    const ctx = makeCtx();
    sched.tick(10_000, ctx);
    expect(fn).not.toHaveBeenCalled();
  });

  it('advances the clock by simDtMs', () => {
    const sched = new Scheduler();
    const ctx = makeCtx();
    sched.tick(100, ctx);
    expect(ctx.clock.now()).toBe(5);  // 100 / 16.667 ≈ 5.9998
  });

  it('passes dt and now to system tick', () => {
    const sched = new Scheduler();
    let seen: { dt: number; now: number } | null = null;
    sched.register({
      name: 's', tickHz: 1,
      tick: (c) => { seen = { dt: c.dt, now: c.now }; },
    });
    const ctx = makeCtx();
    sched.tick(1500, ctx);
    expect(seen).not.toBeNull();
    expect(seen!.dt).toBeGreaterThanOrEqual(1000);
    expect(seen!.now).toBe(ctx.clock.now());
  });
});
