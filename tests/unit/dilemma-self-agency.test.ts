import { describe, it, expect } from 'vitest';
import { NpcActivitySystem } from '@/sim/systems/npc-activity-system';
import { World } from '@/world/world';
import { SimClock } from '@/core/clock';
import { EventLog } from '@/core/events';
import { initNpcProps } from '@/world/npc-helpers';
import { createRng } from '@/core/rng';
import type { GameMap, Entity, NpcProperties } from '@/core/types';

function emptyMap(): GameMap {
  return { tiles: [], width: 32, height: 32, villages: [], seed: 1, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] } as unknown as GameMap;
}
function ctx(world: World) {
  const clock = new SimClock();
  return { world, spirits: new Map(), log: new EventLog(clock), clock, rng: createRng(0), dt: 1000, now: 10 };
}

describe('self-agency', () => {
  it('completing work restores prosperity', () => {
    const world = new World(emptyMap());
    const p = initNpcProps('w', 'farmer', 7);
    p.activity = 'work';
    p.activityDuration = 0;          // expired → re-evaluate this tick
    p.needs.prosperity = 0.2;
    const e: Entity = { id: 'w', kind: 'npc', x: 0, y: 0, properties: p as unknown as Record<string, unknown> };
    world.addEntity(e);

    new NpcActivitySystem().tick(ctx(world));

    expect((e.properties as unknown as NpcProperties).needs.prosperity).toBeCloseTo(0.5, 5);
  });

  it('completing worship does NOT restore meaning (the god grants it)', () => {
    const world = new World(emptyMap());
    const p = initNpcProps('p', 'priest', 7);
    p.activity = 'worship';
    p.activityDuration = 0;
    p.needs.meaning = 0.2;
    const e: Entity = { id: 'p', kind: 'npc', x: 0, y: 0, properties: p as unknown as Record<string, unknown> };
    world.addEntity(e);

    new NpcActivitySystem().tick(ctx(world));

    expect((e.properties as unknown as NpcProperties).needs.meaning).toBeLessThanOrEqual(0.2);
  });
});
