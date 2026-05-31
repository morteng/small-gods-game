import { describe, it, expect } from 'vitest';
import { AbandonmentSystem } from '@/sim/systems/abandonment-system';
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
function add(world: World, id: string, faith: number, rels: NpcProperties['relationships'] = []): Entity {
  const p = initNpcProps(id, 'farmer', 7);
  p.beliefs['player'].faith = faith;
  p.relationships = rels;
  const e: Entity = { id, kind: 'npc', x: 0, y: 0, properties: p as unknown as Record<string, unknown> };
  world.addEntity(e);
  return e;
}
function makeCtx(world: World) {
  const clock = new SimClock();
  const log = new EventLog(clock);
  const events: string[] = [];
  log.subscribe((a) => { if (a.event.type === 'believer_lost') events.push((a.event as { npcId: string }).npcId); });
  return { ctx: { world, spirits: new Map(), log, clock, rng: createRng(0), dt: 1000, now: 0 }, events };
}
function faithOf(world: World, id: string): NpcProperties['beliefs']['player'] {
  return (world.registry.get(id)!.properties as unknown as NpcProperties).beliefs['player'];
}

describe('AbandonmentSystem', () => {
  it('marks an ex-believer as turned away (believer_lost) but never removes them', () => {
    const world = new World(emptyMap());
    add(world, 'gone', 0.5);                  // was a believer
    const { ctx, events } = makeCtx(world);
    const sys = new AbandonmentSystem();

    sys.tick({ ...ctx, now: 0 });             // observed while still believing
    faithOf(world, 'gone').faith = 0;         // now their faith collapses
    for (let i = 1; i <= 12; i++) sys.tick({ ...ctx, now: i });

    expect(world.registry.get('gone')).toBeDefined(); // never deleted
    expect(events).toContain('gone');                 // but the lapse is marked
  });

  it('emits believer_lost only once per lapse, not every tick', () => {
    const world = new World(emptyMap());
    add(world, 'gone', 0.5);
    const { ctx, events } = makeCtx(world);
    const sys = new AbandonmentSystem();

    sys.tick({ ...ctx, now: 0 });
    faithOf(world, 'gone').faith = 0;
    for (let i = 1; i <= 30; i++) sys.tick({ ...ctx, now: i });

    expect(events.filter((id) => id === 'gone')).toHaveLength(1);
  });

  it('re-arms after re-conversion: a won-back believer can lapse (and be marked) again', () => {
    const world = new World(emptyMap());
    add(world, 'fickle', 0.5);
    const { ctx, events } = makeCtx(world);
    const sys = new AbandonmentSystem();

    sys.tick({ ...ctx, now: 0 });
    faithOf(world, 'fickle').faith = 0;                       // first lapse
    for (let i = 1; i <= 12; i++) sys.tick({ ...ctx, now: i });
    faithOf(world, 'fickle').faith = 0.5;                     // won back above the line
    sys.tick({ ...ctx, now: 13 });
    faithOf(world, 'fickle').faith = 0;                       // lapses a second time
    for (let i = 14; i <= 26; i++) sys.tick({ ...ctx, now: i });

    expect(events.filter((id) => id === 'fickle')).toHaveLength(2);
  });

  it('never marks an NPC who was never a believer', () => {
    const world = new World(emptyMap());
    add(world, 'pagan', 0); // faith 0 from the start, never ≥0.15
    const { ctx, events } = makeCtx(world);
    const sys = new AbandonmentSystem();
    for (let i = 0; i < 30; i++) sys.tick({ ...ctx, now: i });
    expect(world.registry.get('pagan')).toBeDefined();
    expect(events).toHaveLength(0);
  });

  it('preserves the relationships of a turned-away ex-believer (still a person in the village)', () => {
    const world = new World(emptyMap());
    add(world, 'gone', 0.5);
    add(world, 'friend', 0.5, [{ npcId: 'gone', type: 'friend', trust: 0.8 }]);
    const { ctx } = makeCtx(world);
    const sys = new AbandonmentSystem();

    sys.tick({ ...ctx, now: 0 });
    faithOf(world, 'gone').faith = 0;
    for (let i = 1; i <= 12; i++) sys.tick({ ...ctx, now: i });

    const friend = world.registry.get('friend')!.properties as unknown as NpcProperties;
    expect(friend.relationships.find((r) => r.npcId === 'gone')).toBeDefined();
  });
});
