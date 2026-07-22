import { describe, it, expect } from 'vitest';
import {
  NpcEncounterSystem, ENCOUNTER_COOLDOWN_TICKS, ENCOUNTER_RADIUS,
  TRUST_WARMTH, TRUST_FRICTION,
} from '@/sim/systems/npc-encounter-system';
import { initNpcProps, npcProps } from '@/world/npc-helpers';
import { World } from '@/world/world';
import { createRng } from '@/core/rng';
import { EventLog, type AppendedEvent } from '@/core/events';
import type { Entity, GameMap, Tile, Relationship } from '@/core/types';

function makeMap(w = 20, h = 20): GameMap {
  const tiles: Tile[][] = [];
  for (let y = 0; y < h; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < w; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
    tiles.push(row);
  }
  return { tiles, width: w, height: h, villages: [], seed: 1, success: true, worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] };
}

/** An NPC placed at (x,y), socializing by default, with a given social graph. */
function makeNpc(
  world: World, id: string, x: number, y: number,
  rels: Relationship[], opts: { activity?: string } = {},
): Entity {
  const props = initNpcProps(id, 'farmer', id.charCodeAt(0) * 37);
  props.activity = (opts.activity ?? 'socialize') as typeof props.activity;
  props.relationships = rels;
  const e: Entity = { id, kind: 'npc', x, y, properties: props as unknown as Record<string, unknown> };
  world.addEntity(e);
  return e;
}

function ctx(world: World, log: EventLog, tick: number) {
  const clock = { now: () => tick, advance: () => {} } as any;
  return { world, spirits: new Map(), log, clock, rng: createRng(1), dt: 1000, now: tick };
}

/** A pair of friends, co-located and both socializing. Returns [world, a, b, log]. */
function friendPair(trust = 0.5, type: Relationship['type'] = 'friend') {
  const world = new World(makeMap());
  const a = makeNpc(world, 'aaa', 5, 5, [{ npcId: 'bbb', type, trust }]);
  const b = makeNpc(world, 'bbb', 6, 5, [{ npcId: 'aaa', type, trust }]);
  const log = new EventLog({ now: () => 0 } as any);
  return { world, a, b, log };
}

describe('NpcEncounterSystem', () => {
  it('two co-located, socializing friends meet: trust warms both sides, both remember, event fires', () => {
    const { world, a, b, log } = friendPair(0.5);
    const events: AppendedEvent[] = [];
    log.subscribe(e => events.push(e));

    new NpcEncounterSystem().tick(ctx(world, log, 1000));

    expect(npcProps(a).relationships[0].trust).toBeCloseTo(0.5 + TRUST_WARMTH, 6);
    expect(npcProps(b).relationships[0].trust).toBeCloseTo(0.5 + TRUST_WARMTH, 6);

    const memA = npcProps(a).memories ?? [];
    const memB = npcProps(b).memories ?? [];
    expect(memA.length).toBe(1);
    expect(memB.length).toBe(1);
    expect(memA[0].kind).toBe('social');
    expect(memA[0].summary).toContain(npcProps(b).name); // remembers the partner by name
    expect(memB[0].summary).toContain(npcProps(a).name);

    const enc = events.filter(e => e.event.type === 'npc_encounter');
    expect(enc.length).toBe(1);
    const ev = enc[0].event as Extract<typeof enc[0]['event'], { type: 'npc_encounter' }>;
    expect(ev.warm).toBe(true);
    expect(ev.aId).toBe('aaa');
    expect(ev.bId).toBe('bbb');
  });

  it('a rival meeting is friction: trust drops on both sides, event is not warm', () => {
    const { world, a, b, log } = friendPair(0.5, 'rival');
    const events: AppendedEvent[] = [];
    log.subscribe(e => events.push(e));

    new NpcEncounterSystem().tick(ctx(world, log, 1000));

    expect(npcProps(a).relationships[0].trust).toBeCloseTo(0.5 + TRUST_FRICTION, 6);
    expect(npcProps(b).relationships[0].trust).toBeCloseTo(0.5 + TRUST_FRICTION, 6);
    const ev = events.find(e => e.event.type === 'npc_encounter')!.event as { warm: boolean };
    expect(ev.warm).toBe(false);
  });

  it('fires ONCE per pair per tick (canonical id order), not twice', () => {
    const { world, log } = friendPair(0.5);
    const events: AppendedEvent[] = [];
    log.subscribe(e => events.push(e));
    new NpcEncounterSystem().tick(ctx(world, log, 1000));
    expect(events.filter(e => e.event.type === 'npc_encounter').length).toBe(1);
  });

  it('respects the per-pair cooldown: an immediate re-tick does not re-fire', () => {
    const { world, a, log } = friendPair(0.5);
    const sys = new NpcEncounterSystem();
    sys.tick(ctx(world, log, 1000));
    const trustAfterFirst = npcProps(a).relationships[0].trust;

    // Same pair, one tick later — inside the cooldown window → no change.
    sys.tick(ctx(world, log, 1060));
    expect(npcProps(a).relationships[0].trust).toBeCloseTo(trustAfterFirst, 6);

    // Past the cooldown → meets again.
    sys.tick(ctx(world, log, 1000 + ENCOUNTER_COOLDOWN_TICKS + 1));
    expect(npcProps(a).relationships[0].trust).toBeCloseTo(trustAfterFirst + TRUST_WARMTH, 6);
  });

  it('does NOT meet when out of range', () => {
    const world = new World(makeMap());
    const a = makeNpc(world, 'aaa', 2, 2, [{ npcId: 'bbb', type: 'friend', trust: 0.5 }]);
    makeNpc(world, 'bbb', 2 + ENCOUNTER_RADIUS + 1, 2, [{ npcId: 'aaa', type: 'friend', trust: 0.5 }]);
    const log = new EventLog({ now: () => 0 } as any);
    const events: AppendedEvent[] = [];
    log.subscribe(e => events.push(e));

    new NpcEncounterSystem().tick(ctx(world, log, 1000));
    expect(events.filter(e => e.event.type === 'npc_encounter').length).toBe(0);
    expect(npcProps(a).relationships[0].trust).toBe(0.5);
  });

  it('does NOT meet unless BOTH are socializing', () => {
    const world = new World(makeMap());
    const a = makeNpc(world, 'aaa', 5, 5, [{ npcId: 'bbb', type: 'friend', trust: 0.5 }]);
    makeNpc(world, 'bbb', 6, 5, [{ npcId: 'aaa', type: 'friend', trust: 0.5 }], { activity: 'work' });
    const log = new EventLog({ now: () => 0 } as any);
    const events: AppendedEvent[] = [];
    log.subscribe(e => events.push(e));

    new NpcEncounterSystem().tick(ctx(world, log, 1000));
    expect(events.filter(e => e.event.type === 'npc_encounter').length).toBe(0);
    expect(npcProps(a).relationships[0].trust).toBe(0.5);
  });

  it('trust is clamped to [0,1] under repeated meetings', () => {
    const { world, a, log } = friendPair(0.99);
    const sys = new NpcEncounterSystem();
    for (let i = 0; i < 5; i++) sys.tick(ctx(world, log, 1000 + i * (ENCOUNTER_COOLDOWN_TICKS + 1)));
    expect(npcProps(a).relationships[0].trust).toBe(1);
  });

  it('serialize/hydrate carries the cooldown (no double-fire after a scrub restore)', () => {
    const { world, a, log } = friendPair(0.5);
    const sys = new NpcEncounterSystem();
    sys.tick(ctx(world, log, 1000));
    const trustAfter = npcProps(a).relationships[0].trust;

    const dump = sys.serialize();
    const restored = new NpcEncounterSystem();
    restored.hydrate(dump);

    // One tick later, inside the window — the restored system remembers they met.
    restored.tick(ctx(world, log, 1060));
    expect(npcProps(a).relationships[0].trust).toBeCloseTo(trustAfter, 6);
  });

  it('hydrate(undefined) resets to a clean slate (old save / no systems field)', () => {
    const { world, a, log } = friendPair(0.5);
    const sys = new NpcEncounterSystem();
    sys.tick(ctx(world, log, 1000));

    sys.hydrate(undefined);
    // Cooldown forgotten → an immediate tick meets again.
    sys.tick(ctx(world, log, 1060));
    expect(npcProps(a).relationships[0].trust).toBeCloseTo(0.5 + 2 * TRUST_WARMTH, 6);
  });

  it('social memories are the most forgettable (lowest salience of any kind)', () => {
    const { world, a, log } = friendPair(0.5);
    new NpcEncounterSystem().tick(ctx(world, log, 1000));
    const mem = (npcProps(a).memories ?? [])[0];
    // below whisper (0.2) and backfill (0.1) — evicted before any divine deed.
    expect(mem.salience).toBeLessThan(0.1);
  });
});
