import { describe, it, expect, beforeEach } from 'vitest';
import { NpcActivitySystem } from '@/sim/systems/npc-activity-system';
import { initNpcProps, npcProps } from '@/world/npc-helpers';
import { World } from '@/world/world';
import { createRng } from '@/core/rng';
import { SilentEventLog } from '@/core/events';
import { tickAtSolarHour } from '@/core/calendar';
import type { Entity, GameMap, Tile, NpcActivity } from '@/core/types';

function makeMap(w = 20, h = 20): GameMap {
  const tiles: Tile[][] = [];
  for (let y = 0; y < h; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < w; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
    tiles.push(row);
  }
  return { tiles, width: w, height: h, villages: [], seed: 1, success: true, worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] };
}

function makeNpc(world: World, id: string, role: 'farmer' | 'priest' | 'merchant' | 'elder' | 'child' | 'beggar' = 'farmer', overrides?: Partial<ReturnType<typeof initNpcProps>>): Entity {
  const props = initNpcProps(id, role, id.charCodeAt(0) * 37);
  props.homeX = 10;
  props.homeY = 10;
  if (overrides) {
    if (overrides.personality) Object.assign(props.personality, overrides.personality);
    if (overrides.beliefs) Object.assign(props.beliefs, overrides.beliefs);
    if (overrides.needs) Object.assign(props.needs, overrides.needs);
  }
  const e: Entity = { id, kind: 'npc', x: 10, y: 10, properties: props as unknown as Record<string, unknown> };
  world.addEntity(e);
  return e;
}

function createContext(world: World, tick: number, seed = 42) {
  const clock = { now: () => tick, advance: () => {} } as any;
  const log = new SilentEventLog(null as any);
  const rng = createRng(seed);
  return { world, spirits: new Map(), log, clock, rng, dt: 1000, now: tick };
}

describe('NpcActivitySystem', () => {
  let system: NpcActivitySystem;

  beforeEach(() => {
    system = new NpcActivitySystem();
  });

  it('sets sleep activity at night (solar 21:00–06:00)', () => {
    const map = makeMap();
    const world = new World(map);
    const e = makeNpc(world, 'alice', 'farmer');

    // Night: 23:00 solar
    system.tick(createContext(world, tickAtSolarHour(23)));
    const props = npcProps(e);
    expect(props.activity).toBe('sleep');
    expect(props.activityTargetX).toBe(10);
    expect(props.activityTargetY).toBe(10);
  });

  it('sets sleep activity also in the small hours (02:00 solar)', () => {
    const map = makeMap();
    const world = new World(map);
    const e = makeNpc(world, 'alice', 'farmer');

    system.tick(createContext(world, tickAtSolarHour(2)));
    expect(npcProps(e).activity).toBe('sleep');
  });

  it('sets work activity for working roles during day', () => {
    const map = makeMap();
    const world = new World(map);
    const e = makeNpc(world, 'bob', 'farmer');

    // Day tick, all needs high
    system.tick(createContext(world, 50));
    const props = npcProps(e);
    expect(props.activity).toBe('work');
    // Target should be near home
    expect(props.activityTargetX).toBeDefined();
    expect(props.activityTargetY).toBeDefined();
  });

  it('sets wander activity for children during day', () => {
    const map = makeMap();
    const world = new World(map);
    const e = makeNpc(world, 'charlie', 'child', {
      personality: { assertiveness: 0.5, skepticism: 0.1, piety: 0.3, sociability: 0.7 },
    });

    system.tick(createContext(world, 50));
    expect(npcProps(e).activity).toBe('wander');
  });

  it('sets idle for low-sociability vagrant roles', () => {
    const map = makeMap();
    const world = new World(map);
    const e = makeNpc(world, 'dave', 'elder', {
      personality: { assertiveness: 0.5, skepticism: 0.1, piety: 0.3, sociability: 0.3 },
    });

    system.tick(createContext(world, 50));
    expect(npcProps(e).activity).toBe('idle');
  });

  it('sets socialize when community need is low', () => {
    const map = makeMap();
    const world = new World(map);
    const e = makeNpc(world, 'eve', 'farmer', {
      needs: { safety: 0.8, prosperity: 0.8, community: 0.2, meaning: 0.7 },
    });

    system.tick(createContext(world, 50));
    expect(npcProps(e).activity).toBe('socialize');
  });

  it('sets worship when meaning need is low', () => {
    const map = makeMap();
    const world = new World(map);
    const e = makeNpc(world, 'frank', 'farmer', {
      needs: { safety: 0.8, prosperity: 0.8, community: 0.6, meaning: 0.2 },
    });

    system.tick(createContext(world, 50));
    expect(npcProps(e).activity).toBe('worship');
  });

  it('activity has a duration > 0 and decrements each tick', () => {
    const map = makeMap();
    const world = new World(map);
    const e = makeNpc(world, 'grace', 'farmer');

    system.tick(createContext(world, 50));
    const initialDuration = npcProps(e).activityDuration;
    expect(initialDuration).toBeGreaterThan(0);

    // Tick again — duration should decrease
    system.tick(createContext(world, 51));
    expect(npcProps(e).activityDuration).toBeLessThan(initialDuration);
  });

  it('re-evaluates activity when duration reaches 0', () => {
    const map = makeMap();
    const world = new World(map);
    const e = makeNpc(world, 'heidi', 'farmer');
    const props = npcProps(e);

    // Force activity to 'idle' with short remaining duration
    props.activity = 'idle';
    props.activityDuration = 1;
    props.activityTargetX = undefined;
    props.activityTargetY = undefined;

    // One tick decrements to 0, next tick re-evaluates
    system.tick(createContext(world, 50));
    expect(props.activity).toBe('idle'); // duration was 1 → stays idle

    system.tick(createContext(world, 51));
    // Now should switch to 'work' since duration hit 0
    expect(props.activity).toBe('work');
  });

  it('is deterministic with same seed', () => {
    const run = (seed: number) => {
      const map = makeMap();
      const world = new World(map);
      const e = makeNpc(world, 'ivy', 'farmer');
      const sys = new NpcActivitySystem();
      for (let t = 50; t < 70; t++) {
        sys.tick(createContext(world, t, seed));
      }
      return { activity: npcProps(e).activity, targetX: npcProps(e).activityTargetX };
    };

    const r1 = run(42);
    const r2 = run(42);
    expect(r1).toEqual(r2);
  });
});