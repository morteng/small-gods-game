// Smoke test for the Phase 0 interaction-scaling probe's instrumentation seam
// (docs/superpowers/plans/2026-08-01-interaction-scaling-plan.md, S0.1): the
// optional `onEncounter`/`onRumour` hook on NpcEncounterSystem and the optional
// `onPropagate` hook on BeliefPropagationSystem. Both are settable AFTER
// construction, default undefined, and must fire DETERMINISTICALLY — same
// micro-world, same seed, same hook call counts every run — since
// scripts/probe-scaling.ts sums them across a multi-hour tick loop and feeds
// the sums into a log-log fit.
import { describe, it, expect } from 'vitest';
import { NpcEncounterSystem } from '@/sim/systems/npc-encounter-system';
import { BeliefPropagationSystem } from '@/sim/systems/belief-propagation-system';
import { addDomainBelief } from '@/sim/belief-domains';
import { initNpcProps } from '@/world/npc-helpers';
import { World } from '@/world/world';
import { createRng } from '@/core/rng';
import { EventLog } from '@/core/events';
import type { Entity, GameMap, Tile, Relationship, EntityId } from '@/core/types';

function makeMap(w = 20, h = 20): GameMap {
  const tiles: Tile[][] = [];
  for (let y = 0; y < h; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < w; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
    tiles.push(row);
  }
  return { tiles, width: w, height: h, villages: [], seed: 1, success: true, worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] };
}

function ctx(world: World, log: EventLog, tick: number, seed = 1) {
  const clock = { now: () => tick, advance: () => {} } as any;
  return { world, spirits: new Map(), log, clock, rng: createRng(seed), dt: 1000, now: tick };
}

/** Two co-located, socializing NPCs sharing a warm relationship, one of whom
 *  (a) has a domain belief the other (b) doesn't yet hold — so a fully wired
 *  tick fires both an encounter AND a rumour. */
function socializingPair(): { world: World; a: Entity; b: Entity; log: EventLog } {
  const world = new World(makeMap());
  const rel: Relationship = { npcId: 'bbb', type: 'friend', trust: 0.6 };
  const relBack: Relationship = { npcId: 'aaa', type: 'friend', trust: 0.6 };

  const pa = initNpcProps('aaa', 'farmer', 1);
  pa.activity = 'socialize';
  pa.homePoiId = 'village_1';
  pa.relationships = [rel];
  addDomainBelief(pa, 'zephyr', 'storm', 0.9);
  world.addEntity({ id: 'aaa', kind: 'npc', x: 5, y: 5, properties: pa as unknown as Record<string, unknown> });

  const pb = initNpcProps('bbb', 'farmer', 2);
  pb.activity = 'socialize';
  pb.homePoiId = 'village_1';
  pb.relationships = [relBack];
  pb.beliefs.zephyr = { faith: 0.5, understanding: 0.1, devotion: 0.1 }; // believes zephyr exists, not its deeds yet
  world.addEntity({ id: 'bbb', kind: 'npc', x: 6, y: 5, properties: pb as unknown as Record<string, unknown> });

  const log = new EventLog({ now: () => 0 } as any);
  return { world, a: world.registry.get('aaa')!, b: world.registry.get('bbb')!, log };
}

describe('probe-scaling instrumentation hooks', () => {
  it('NpcEncounterSystem: onEncounter/onRumour are undefined by default — zero behaviour change', () => {
    const { world, log } = socializingPair();
    const sys = new NpcEncounterSystem();
    expect(sys.onEncounter).toBeUndefined();
    expect(sys.onRumour).toBeUndefined();
    // Ticking with no hooks attached must not throw.
    expect(() => sys.tick(ctx(world, log, 1000))).not.toThrow();
  });

  it('NpcEncounterSystem: onEncounter fires once for the pair, onRumour fires once per direction that actually pulled a gap', () => {
    const { world, log } = socializingPair();
    const sys = new NpcEncounterSystem();
    const encounterCalls: [EntityId, EntityId, string | undefined, boolean][] = [];
    const rumourCalls: [EntityId, EntityId, string | undefined][] = [];
    sys.onEncounter = (a, b, poiId, warm) => encounterCalls.push([a, b, poiId, warm]);
    sys.onRumour = (from, to, poiId) => rumourCalls.push([from, to, poiId]);

    sys.tick(ctx(world, log, 1000));

    expect(encounterCalls).toEqual([['aaa', 'bbb', 'village_1', true]]);
    // a → b pulls b toward a's stronger 'storm' belief (a gap > 0); b → a has
    // nothing to spread back (b holds no domain beliefs at all) — exactly one
    // direction applies.
    expect(rumourCalls).toEqual([['aaa', 'bbb', 'village_1']]);
  });

  it('NpcEncounterSystem hooks are deterministic: same micro-world, same seed, identical call counts both runs', () => {
    const run = (): { encounters: number; rumours: number } => {
      const { world, log } = socializingPair();
      const sys = new NpcEncounterSystem();
      let encounters = 0, rumours = 0;
      sys.onEncounter = () => { encounters++; };
      sys.onRumour = () => { rumours++; };
      sys.tick(ctx(world, log, 1000));
      return { encounters, rumours };
    };
    expect(run()).toEqual(run());
  });

  it('BeliefPropagationSystem: onPropagate is undefined by default — zero behaviour change', () => {
    const world = new World(makeMap());
    const sys = new BeliefPropagationSystem();
    expect(sys.onPropagate).toBeUndefined();
    expect(() => sys.tick(ctx(world, new EventLog({ now: () => 0 } as any), 0))).not.toThrow();
  });

  it('BeliefPropagationSystem: onPropagate fires on the deterministic communion inflow', () => {
    const world = new World(makeMap());
    const pa = initNpcProps('aaa', 'farmer', 1);
    pa.personality.sociability = 0.8;
    pa.personality.skepticism = 0.2;
    pa.beliefs.player = { faith: 0.4, understanding: 0.2, devotion: 0.1 }; // already a believer
    pa.relationships = [{ npcId: 'bbb', type: 'friend', trust: 0.7 }];
    world.addEntity({ id: 'aaa', kind: 'npc', x: 0, y: 0, properties: pa as unknown as Record<string, unknown> });

    const pb = initNpcProps('bbb', 'priest', 2);
    pb.beliefs.player = { faith: 0.9, understanding: 0.5, devotion: 0.3 }; // strong believer neighbour
    world.addEntity({ id: 'bbb', kind: 'npc', x: 0, y: 0, properties: pb as unknown as Record<string, unknown> });

    const sys = new BeliefPropagationSystem();
    const calls: [EntityId, 'commune' | 'propagate', number][] = [];
    sys.onPropagate = (id, kind, delta) => calls.push([id, kind, delta]);

    sys.tick(ctx(world, new EventLog({ now: () => 0 } as any), 0));

    const communeCalls = calls.filter(([, kind]) => kind === 'commune');
    expect(communeCalls.length).toBeGreaterThan(0);
    expect(communeCalls[0][0]).toBe('aaa');
    expect(communeCalls[0][2]).toBeGreaterThan(0);
  });

  it('BeliefPropagationSystem hooks are deterministic: same micro-world, same seed, identical delta sum both runs', () => {
    const run = (): number => {
      const world = new World(makeMap());
      const pa = initNpcProps('aaa', 'farmer', 1);
      pa.personality.sociability = 0.8;
      pa.personality.skepticism = 0.2;
      pa.beliefs.player = { faith: 0.4, understanding: 0.2, devotion: 0.1 };
      pa.relationships = [{ npcId: 'bbb', type: 'friend', trust: 0.7 }];
      world.addEntity({ id: 'aaa', kind: 'npc', x: 0, y: 0, properties: pa as unknown as Record<string, unknown> });
      const pb = initNpcProps('bbb', 'priest', 2);
      pb.beliefs.player = { faith: 0.9, understanding: 0.5, devotion: 0.3 };
      world.addEntity({ id: 'bbb', kind: 'npc', x: 0, y: 0, properties: pb as unknown as Record<string, unknown> });

      const sys = new BeliefPropagationSystem();
      let sum = 0;
      sys.onPropagate = (_id, _kind, delta) => { sum += delta; };
      sys.tick(ctx(world, new EventLog({ now: () => 0 } as any), 0, 7));
      return sum;
    };
    expect(run()).toBeCloseTo(run(), 12);
  });
});
