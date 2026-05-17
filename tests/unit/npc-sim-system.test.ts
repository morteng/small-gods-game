import { describe, it, expect } from 'vitest';
import { NpcSimSystem } from '@/sim/systems/npc-sim-system';
import { World } from '@/world/world';
import { SimClock } from '@/core/clock';
import { EventLog } from '@/core/events';
import { initNpcProps } from '@/world/npc-helpers';
import { createRng } from '@/core/rng';
import type { GameMap, Entity, NpcProperties } from '@/core/types';

function makeCtx() {
  const clock = new SimClock();
  const log = new EventLog(clock);
  const world = new World({
    tiles: [], width: 10, height: 10, villages: [], seed: 1,
    success: true, worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [],
  } as GameMap);
  return { world, log, clock, spirits: new Map(), rng: createRng(0) };
}

function addNpc(world: World, id: string, faith: number): Entity {
  const props = initNpcProps('Alice', 'farmer', 42);
  props.beliefs['player'].faith = faith;
  const e: Entity = { id, kind: 'npc', x: 0, y: 0, properties: props as unknown as Record<string, unknown> };
  world.addEntity(e);
  return e;
}

describe('NpcSimSystem', () => {
  it('ticks sim state for all npc entities', () => {
    const sys = new NpcSimSystem();
    const ctx = makeCtx();
    const e = addNpc(ctx.world, 'n1', 0.5);
    const before = (e.properties as unknown as NpcProperties).beliefs['player'].faith;
    sys.tick({ ...ctx, dt: 1000, now: 0 });
    expect((e.properties as unknown as NpcProperties).beliefs['player'].faith).toBeLessThanOrEqual(before);
  });

  it('emits belief_cross high when faith first crosses 0.6 upward', () => {
    const sys = new NpcSimSystem();
    const ctx = makeCtx();
    const e = addNpc(ctx.world, 'n1', 0.59);
    // Manually bump above threshold and re-tick
    (e.properties as unknown as NpcProperties).beliefs['player'].faith = 0.62;
    sys.tick({ ...ctx, dt: 1000, now: 5 });
    const evts = ctx.log.since(0).map(a => a.event);
    expect(evts.some(e => e.type === 'belief_cross' && e.kind === 'high' && e.npcId === 'n1')).toBe(true);
  });

  it('emits belief_cross low when faith drops below 0.3', () => {
    const sys = new NpcSimSystem();
    const ctx = makeCtx();
    const e = addNpc(ctx.world, 'n1', 0.31);
    // First tick establishes baseline above threshold
    sys.tick({ ...ctx, dt: 1000, now: 1 });
    // Manually drop
    (e.properties as unknown as NpcProperties).beliefs['player'].faith = 0.25;
    sys.tick({ ...ctx, dt: 1000, now: 2 });
    const evts = ctx.log.since(0).map(a => a.event);
    expect(evts.some(e => e.type === 'belief_cross' && e.kind === 'low')).toBe(true);
  });

  it('does not re-emit belief_cross while staying on the same side of threshold', () => {
    const sys = new NpcSimSystem();
    const ctx = makeCtx();
    addNpc(ctx.world, 'n1', 0.7);
    sys.tick({ ...ctx, dt: 1000, now: 1 });
    sys.tick({ ...ctx, dt: 1000, now: 2 });
    sys.tick({ ...ctx, dt: 1000, now: 3 });
    const crosses = ctx.log.since(0).map(a => a.event).filter(e => e.type === 'belief_cross');
    expect(crosses.length).toBeLessThanOrEqual(1);
  });
});
