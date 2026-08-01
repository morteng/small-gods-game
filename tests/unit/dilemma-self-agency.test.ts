import { describe, it, expect } from 'vitest';
import { NpcActivitySystem, RITE_MEANING_RESTORE, MORTAL_MEANING_CEILING } from '@/sim/systems/npc-activity-system';
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

  // S2c: `worship` still gets no SELF_AGENCY_RESTORE — but it is no longer true
  // that NOTHING mortal restores `meaning`. A mortal performing its plea at the
  // settlement's shrine recovers RITE_MEANING_RESTORE per fire, capped at
  // MORTAL_MEANING_CEILING (the communal rite; VISION §11's rites of the dead).
  // The old assertion encoded "meaning only ever moves when a god Answers",
  // which measured out as 99% of all NPC-time locked in permanent prayer. What
  // must still hold, and is what this test now pins, is the SHAPE: the rite is a
  // trickle next to a self-agency restore, and it can never carry a soul to
  // contentment.
  it('completing worship gives only the capped communal rite, never SELF_AGENCY_RESTORE', () => {
    const world = new World(emptyMap());
    const p = initNpcProps('p', 'priest', 7);
    p.activity = 'worship';
    p.activityDuration = 0;
    p.needs.meaning = 0.2;
    const e: Entity = { id: 'p', kind: 'npc', x: 0, y: 0, properties: p as unknown as Record<string, unknown> };
    world.addEntity(e);

    new NpcActivitySystem().tick(ctx(world));

    const after = (e.properties as unknown as NpcProperties).needs.meaning;
    expect(after).toBeCloseTo(0.2 + RITE_MEANING_RESTORE, 8);
    expect(after).toBeLessThan(0.2 + 0.3 / 100);   // nowhere near SELF_AGENCY_RESTORE
  });

  it('the communal rite cannot carry a mortal past MORTAL_MEANING_CEILING', () => {
    const world = new World(emptyMap());
    const p = initNpcProps('c', 'priest', 7);
    p.activity = 'worship';
    p.activityDuration = 0;
    p.needs.meaning = MORTAL_MEANING_CEILING - RITE_MEANING_RESTORE / 2;
    const e: Entity = { id: 'c', kind: 'npc', x: 0, y: 0, properties: p as unknown as Record<string, unknown> };
    world.addEntity(e);

    new NpcActivitySystem().tick(ctx(world));

    expect((e.properties as unknown as NpcProperties).needs.meaning).toBe(MORTAL_MEANING_CEILING);
    expect(MORTAL_MEANING_CEILING).toBeLessThan(0.6);   // below COMFORT_THRESHOLD: gods own the top
  });
});
