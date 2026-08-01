/**
 * Interaction scaling S2a.2 — runtime acquaintance formation.
 *
 * The mechanism that makes encounter rate DENSITY-dependent: strangers who share
 * the settlement's green start to know each other, within a per-day and a
 * total-degree budget, deterministically off `ctx.rng`. Plus the fold-back
 * contract — an extra's acquaintances dissolve when it goes back into the crowd,
 * and no survivor is left holding a dangling id.
 */
import { describe, it, expect } from 'vitest';
import {
  NpcEncounterSystem, ACQUAINTANCE_TRUST, MAX_ACQUAINTANCES_PER_DAY, MAX_SOCIAL_DEGREE,
} from '@/sim/systems/npc-encounter-system';
import { dropRelationshipsTo, addAcquaintance } from '@/sim/social-graph';
import { initNpcProps, npcProps } from '@/world/npc-helpers';
import { World } from '@/world/world';
import { createRng } from '@/core/rng';
import { EventLog } from '@/core/events';
import { TICKS_PER_DAY } from '@/core/calendar';
import type { Entity, GameMap, Tile, Relationship } from '@/core/types';
import { makeHarness } from './materialization-harness';

function makeMap(w = 20, h = 20): GameMap {
  const tiles: Tile[][] = [];
  for (let y = 0; y < h; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < w; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
    tiles.push(row);
  }
  return { tiles, width: w, height: h, villages: [], seed: 1, success: true, worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] };
}

/** A gathering (socializing) mortal at (x,y) with a given sociability. */
function gatherer(
  world: World, id: string, x: number, y: number,
  sociability = 1, rels: Relationship[] = [],
): Entity {
  const props = initNpcProps(id, 'farmer', id.charCodeAt(0) * 37);
  props.activity = 'socialize';
  props.personality.sociability = sociability;
  props.relationships = rels;
  props.homePoiId = 'village';
  const e: Entity = { id, kind: 'npc', x, y, properties: props as unknown as Record<string, unknown> };
  world.addEntity(e);
  return e;
}

function ctx(world: World, log: EventLog, tick: number, seed = 7) {
  const clock = { now: () => tick, advance: () => {} } as never;
  return { world, spirits: new Map(), log, clock, rng: createRng(seed), dt: 1000, now: tick };
}

/** Tick the system `n` times at 1-tick spacing from `start`. */
function run(sys: NpcEncounterSystem, world: World, log: EventLog, n: number, start = 1000, seed = 7): void {
  for (let i = 0; i < n; i++) sys.tick(ctx(world, log, start + i, seed + i));
}

describe('acquaintance formation (S2a.2)', () => {
  it('two co-located strangers at the green eventually strike up a mutual weak friendship', () => {
    const world = new World(makeMap());
    const a = gatherer(world, 'aaa', 5, 5);
    const b = gatherer(world, 'bbb', 6, 5);
    const log = new EventLog({ now: () => 0 } as never);

    run(new NpcEncounterSystem(), world, log, 400);

    const relA = npcProps(a).relationships;
    const relB = npcProps(b).relationships;
    expect(relA).toHaveLength(1);
    expect(relB).toHaveLength(1);
    expect(relA[0]).toMatchObject({ npcId: 'bbb', type: 'friend' });
    expect(relB[0]).toMatchObject({ npcId: 'aaa', type: 'friend' });
    // Starts weak; the ordinary encounter loop has warmed it at most once by now.
    expect(relA[0].trust).toBeGreaterThanOrEqual(ACQUAINTANCE_TRUST);
    expect(relA[0].trust).toBeLessThan(0.2);
  });

  it('strangers who are NOT co-located never become acquainted', () => {
    const world = new World(makeMap());
    const a = gatherer(world, 'aaa', 2, 2);
    gatherer(world, 'bbb', 15, 15);
    const log = new EventLog({ now: () => 0 } as never);

    run(new NpcEncounterSystem(), world, log, 400);
    expect(npcProps(a).relationships).toHaveLength(0);
  });

  it('a mortal who is not at a gathering (working) makes no acquaintances', () => {
    const world = new World(makeMap());
    const a = gatherer(world, 'aaa', 5, 5);
    const b = gatherer(world, 'bbb', 6, 5);
    npcProps(b).activity = 'work';
    const log = new EventLog({ now: () => 0 } as never);

    run(new NpcEncounterSystem(), world, log, 400);
    expect(npcProps(a).relationships).toHaveLength(0);
  });

  it('is deterministic: same seed sequence, same edges', () => {
    const build = () => {
      const world = new World(makeMap());
      for (let i = 0; i < 6; i++) gatherer(world, `npc${i}`, 5 + (i % 2), 5 + Math.floor(i / 2) % 2, 0.6);
      return world;
    };
    const snap = (world: World): string => JSON.stringify(
      world.query({ kind: 'npc' }).map(e => [e.id, npcProps(e).relationships.map(r => r.npcId)]),
    );

    const w1 = build(); run(new NpcEncounterSystem(), w1, new EventLog({ now: () => 0 } as never), 200);
    const w2 = build(); run(new NpcEncounterSystem(), w2, new EventLog({ now: () => 0 } as never), 200);
    expect(snap(w1)).toBe(snap(w2));
  });

  it('BUDGET: a mortal forms at most MAX_ACQUAINTANCES_PER_DAY new edges in one game-day', () => {
    const world = new World(makeMap());
    // One hub surrounded by many strangers, all sociable, all on one tile cluster.
    const hub = gatherer(world, 'aaa', 5, 5);
    for (let i = 0; i < 10; i++) gatherer(world, `b${i}`, 5 + (i % 3) - 1, 5 + Math.floor(i / 3) - 1);
    const log = new EventLog({ now: () => 0 } as never);

    // Tick hard, but stay inside ONE game-day.
    run(new NpcEncounterSystem(), world, log, 3000, 1000);
    expect(npcProps(hub).relationships.length).toBe(MAX_ACQUAINTANCES_PER_DAY);
  });

  it('the day budget refreshes when the game-day rolls over', () => {
    const world = new World(makeMap());
    const hub = gatherer(world, 'aaa', 5, 5);
    for (let i = 0; i < 10; i++) gatherer(world, `b${i}`, 5 + (i % 3) - 1, 5 + Math.floor(i / 3) - 1);
    const log = new EventLog({ now: () => 0 } as never);
    const sys = new NpcEncounterSystem();

    run(sys, world, log, 2000, 1000);
    expect(npcProps(hub).relationships.length).toBe(MAX_ACQUAINTANCES_PER_DAY);

    run(sys, world, log, 2000, TICKS_PER_DAY + 1000);
    expect(npcProps(hub).relationships.length).toBeGreaterThan(MAX_ACQUAINTANCES_PER_DAY);
  });

  it('BUDGET: total degree never exceeds MAX_SOCIAL_DEGREE, however many days pass', () => {
    const world = new World(makeMap());
    const hub = gatherer(world, 'aaa', 5, 5);
    for (let i = 0; i < 20; i++) gatherer(world, `b${String(i).padStart(2, '0')}`, 5 + (i % 3) - 1, 5 + Math.floor(i / 5) - 1);
    const log = new EventLog({ now: () => 0 } as never);
    const sys = new NpcEncounterSystem();

    for (let day = 0; day < 12; day++) run(sys, world, log, 900, day * TICKS_PER_DAY + 1000);
    expect(npcProps(hub).relationships.length).toBeLessThanOrEqual(MAX_SOCIAL_DEGREE);
    expect(npcProps(hub).relationships.length).toBe(MAX_SOCIAL_DEGREE);
  });

  it('serialize/hydrate carries the per-day budget (a scrub does not refund it)', () => {
    const world = new World(makeMap());
    const hub = gatherer(world, 'aaa', 5, 5);
    for (let i = 0; i < 10; i++) gatherer(world, `b${i}`, 5 + (i % 3) - 1, 5 + Math.floor(i / 3) - 1);
    const log = new EventLog({ now: () => 0 } as never);
    const sys = new NpcEncounterSystem();
    run(sys, world, log, 2000, 1000);
    const spent = npcProps(hub).relationships.length;
    expect(spent).toBe(MAX_ACQUAINTANCES_PER_DAY);

    const restored = new NpcEncounterSystem();
    restored.hydrate(sys.serialize());
    run(restored, world, log, 2000, 3200);
    expect(npcProps(hub).relationships.length).toBe(spent); // still spent for today
  });

  it('hydrate of a pre-S2a dump (no budget field) reads as a clean slate', () => {
    const world = new World(makeMap());
    const a = gatherer(world, 'aaa', 5, 5);
    gatherer(world, 'bbb', 6, 5);
    const log = new EventLog({ now: () => 0 } as never);
    const sys = new NpcEncounterSystem();
    sys.hydrate({ lastMet: [] });                     // old shape
    run(sys, world, log, 400);
    expect(npcProps(a).relationships.length).toBe(1);
  });

  it('the acquaintance pass fires AFTER the encounter pass — a new edge does not also meet on the same tick', () => {
    const world = new World(makeMap());
    const a = gatherer(world, 'aaa', 5, 5);
    gatherer(world, 'bbb', 6, 5);
    const log = new EventLog({ now: () => 0 } as never);
    const events: unknown[] = [];
    log.subscribe(e => { if (e.event.type === 'npc_encounter') events.push(e); });

    const sys = new NpcEncounterSystem();
    // Tick until the edge exists; on that very tick there must be no encounter yet.
    let ticks = 0;
    while (npcProps(a).relationships.length === 0 && ticks < 1000) { sys.tick(ctx(world, log, 1000 + ticks, 7 + ticks)); ticks++; }
    expect(npcProps(a).relationships.length).toBe(1);
    expect(npcProps(a).relationships[0].trust).toBe(ACQUAINTANCE_TRUST);  // un-warmed
    expect(events.length).toBe(0);
  });
});

describe('dropRelationshipsTo / fold-back (S2a.2)', () => {
  it('erases every edge pointing at the departed soul, leaving the survivors intact', () => {
    const world = new World(makeMap());
    const a = gatherer(world, 'aaa', 5, 5);
    const b = gatherer(world, 'bbb', 6, 5);
    const c = gatherer(world, 'ccc', 7, 5);
    addAcquaintance(a, b, 0.15);
    addAcquaintance(a, c, 0.15);

    dropRelationshipsTo(world.query({ kind: 'npc' }), 'aaa');

    expect(npcProps(b).relationships.map(r => r.npcId)).toEqual([]);
    expect(npcProps(c).relationships.map(r => r.npcId)).toEqual([]);
    // a's own array is irrelevant — its entity leaves with it — but must not throw.
    expect(npcProps(a).relationships.length).toBe(2);
  });

  it('a folded extra leaves no dangling relationship id on the mortals it befriended', () => {
    const h = makeHarness({ cottages: 8, souls: 12 });
    h.materializeFully('village');
    const extras = h.world.query({ kind: 'npc' }).filter(e => npcProps(e).materializedTemp === true);
    expect(extras.length).toBeGreaterThan(1);

    // Two extras befriend each other at the green.
    addAcquaintance(extras[0], extras[1], 0.15);
    expect(npcProps(extras[1]).relationships.map(r => r.npcId)).toEqual([extras[0].id]);

    h.foldFully();

    // Everyone still in the world holds only edges to entities that still exist.
    const living = new Set(h.world.query({ kind: 'npc' }).map(e => e.id));
    for (const e of h.world.query({ kind: 'npc' })) {
      for (const rel of npcProps(e).relationships) expect(living.has(rel.npcId)).toBe(true);
    }
  });
});
