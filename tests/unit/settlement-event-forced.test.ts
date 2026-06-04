import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import { SimClock } from '@/core/clock';
import { createRng } from '@/core/rng';
import { EventLog } from '@/core/events';
import { SettlementEventSystem } from '@/sim/systems/settlement-event-system';
import { initNpcProps } from '@/world/npc-helpers';
import type { SystemContext } from '@/core/scheduler';
import type { GameMap, Tile, Entity } from '@/core/types';

function map(): GameMap {
  const tiles: Tile[][] = [];
  for (let y = 0; y < 2; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < 2; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
    tiles.push(row);
  }
  return { tiles, width: 2, height: 2, villages: [], seed: 1, success: true,
           worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] };
}
function ctxFor(world: World, log: EventLog, clock: SimClock): SystemContext {
  return { world, clock, rng: createRng(1), log, spirits: new Map(), now: clock.now(), dt: 1 } as unknown as SystemContext;
}
function resident(world: World, poiId: string) {
  const p = initNpcProps('r1', 'farmer', 7); p.homePoiId = poiId;
  world.addEntity({ id: 'r1', kind: 'npc', x: 1, y: 1, properties: p as unknown as Record<string, unknown> } as Entity);
}

describe('SettlementEventSystem forced events', () => {
  it('materializes the forced event type on the next eligible tick and clears the bias', () => {
    const world = new World(map()); const log = new EventLog(new SimClock()); const clock = new SimClock();
    resident(world, 'poi1');
    world.forcedEvents.set('poi1', 'plague');
    const sys = new SettlementEventSystem();
    sys.tick(ctxFor(world, log, clock));
    const events = world.activeEvents.get('poi1');
    expect(events).toHaveLength(1);
    expect(events![0].type).toBe('plague');
    expect(world.forcedEvents.has('poi1')).toBe(false);
    const begins = log.since(0).map((e) => e.event).filter((e) => e.type === 'settlement_begin');
    expect(begins.some((e) => (e as { eventType: string }).eventType === 'plague')).toBe(true);
  });

  it('leaves the bias intact while the POI already has an active event', () => {
    const world = new World(map()); const log = new EventLog(new SimClock()); const clock = new SimClock();
    resident(world, 'poi1');
    world.activeEvents.set('poi1', [{ type: 'festival', poiId: 'poi1', severity: 0.5, durationTicks: 100, ticksElapsed: 0 }]);
    world.forcedEvents.set('poi1', 'plague');
    const sys = new SettlementEventSystem();
    sys.tick(ctxFor(world, log, clock));
    expect(world.activeEvents.get('poi1')![0].type).toBe('festival');  // unchanged
    expect(world.forcedEvents.get('poi1')).toBe('plague');             // still pending
  });
});
