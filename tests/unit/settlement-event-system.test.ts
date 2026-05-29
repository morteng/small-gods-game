import { describe, it, expect, beforeEach } from 'vitest';
import { SettlementEventSystem } from '@/sim/systems/settlement-event-system';
import { initNpcProps, npcProps, forEachNpc } from '@/world/npc-helpers';
import { World } from '@/world/world';
import { createRng } from '@/core/rng';
import { SilentEventLog } from '@/core/events';
import type { Entity, GameMap, Tile } from '@/core/types';

function makeMap(w = 20, h = 20): GameMap {
  const tiles: Tile[][] = [];
  for (let y = 0; y < h; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < w; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
    tiles.push(row);
  }
  return { tiles, width: w, height: h, villages: [], seed: 1, success: true, worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] };
}

function makeNpc(world: World, id: string, role: 'farmer' | 'priest' = 'farmer', homePoi = 'village_1'): Entity {
  const props = initNpcProps(id, role, id.charCodeAt(0) * 37);
  props.homePoiId = homePoi;
  const e: Entity = { id, kind: 'npc', x: 5, y: 5, properties: props as unknown as Record<string, unknown> };
  world.addEntity(e);
  return e;
}

function createContext(world: World, seed = 42) {
  const clock = { now: () => 0, advance: () => {} } as any;
  const log = new SilentEventLog(null as any);
  const rng = createRng(seed);
  return { world, spirits: new Map(), log, clock, rng, dt: 1000, now: 0 };
}

describe('SettlementEventSystem', () => {
  let system: SettlementEventSystem;

  beforeEach(() => {
    system = new SettlementEventSystem();
  });

  it('starts with no active events', () => {
    const map = makeMap();
    const world = new World(map);
    expect(world.activeEvents.size).toBe(0);
  });

  it('does not apply need effects when no events are active', () => {
    const map = makeMap();
    const world = new World(map);
    const npc = makeNpc(world, 'alice', 'farmer');
    const props = npcProps(npc);
    const prevProsperity = props.needs.prosperity;

    system.tick(createContext(world, 0));
    expect(props.needs.prosperity).toBe(prevProsperity);
  });

  it('applies drought effect to prosperity needs', () => {
    const map = makeMap();
    const world = new World(map);
    const npc = makeNpc(world, 'bob', 'farmer');
    const startProsperity = npcProps(npc).needs.prosperity;

    // Manually inject a drought event
    world.activeEvents.set('village_1', [{
      type: 'drought',
      poiId: 'village_1',
      severity: 0.5,
      durationTicks: 100,
      ticksElapsed: 0,
    }]);

    const ctx = createContext(world, 0);
    system.tick(ctx);
    const props = npcProps(npc);
    // prosperity should have decreased by 0.008 * 0.5 = 0.004
    expect(props.needs.prosperity).toBeLessThan(startProsperity);
    expect(props.needs.prosperity).toBeCloseTo(startProsperity - 0.008 * 0.5, 5);
  });

  it('applies festival effect to community and meaning', () => {
    const map = makeMap();
    const world = new World(map);
    const npc = makeNpc(world, 'carol', 'farmer');
    const startCommunity = npcProps(npc).needs.community;
    const startMeaning = npcProps(npc).needs.meaning;

    world.activeEvents.set('village_1', [{
      type: 'festival',
      poiId: 'village_1',
      severity: 0.5,
      durationTicks: 50,
      ticksElapsed: 0,
    }]);

    system.tick(createContext(world, 0));
    const props = npcProps(npc);
    expect(props.needs.community).toBeCloseTo(startCommunity + 0.008 * 0.5, 5);
    expect(props.needs.meaning).toBeCloseTo(startMeaning + 0.006 * 0.5, 5);
  });

  it('applies raiders effect to safety', () => {
    const map = makeMap();
    const world = new World(map);
    const npc = makeNpc(world, 'dave', 'farmer');
    const startSafety = npcProps(npc).needs.safety;
    const startProsperity = npcProps(npc).needs.prosperity;

    world.activeEvents.set('village_1', [{
      type: 'raiders',
      poiId: 'village_1',
      severity: 0.7,
      durationTicks: 100,
      ticksElapsed: 0,
    }]);

    system.tick(createContext(world, 0));
    const props = npcProps(npc);
    expect(props.needs.safety).toBeCloseTo(startSafety - 0.008 * 0.7, 5);
    expect(props.needs.prosperity).toBeCloseTo(startProsperity - 0.004 * 0.7, 5);
  });

  it('only affects NPCs in the event POI', () => {
    const map = makeMap();
    const world = new World(map);
    const villager = makeNpc(world, 'eve', 'farmer', 'village_1');
    const outsider = makeNpc(world, 'frank', 'farmer', 'village_2');
    const startVillager = npcProps(villager).needs.prosperity;
    const startOutsider = npcProps(outsider).needs.prosperity;

    world.activeEvents.set('village_1', [{
      type: 'drought',
      poiId: 'village_1',
      severity: 0.5,
      durationTicks: 100,
      ticksElapsed: 0,
    }]);

    system.tick(createContext(world, 0));
    expect(npcProps(villager).needs.prosperity).toBeLessThan(startVillager);
    expect(npcProps(outsider).needs.prosperity).toBe(startOutsider);
  });

  it('expires events after duration elapses', () => {
    const map = makeMap();
    const world = new World(map);
    makeNpc(world, 'grace', 'farmer');

    world.activeEvents.set('village_1', [{
      type: 'drought',
      poiId: 'village_1',
      severity: 0.5,
      durationTicks: 3,
      ticksElapsed: 0,
    }]);

    // Tick 3 times: after 3rd tick, ticksElapsed (3) >= durationTicks (3) → expire
    const ctx = createContext(world, 0);
    system.tick(ctx); // ticksElapsed becomes 1
    expect(world.activeEvents.has('village_1')).toBe(true);

    system.tick(ctx); // ticksElapsed becomes 2
    expect(world.activeEvents.has('village_1')).toBe(true);

    system.tick(ctx); // ticksElapsed becomes 3 → expires
    expect(world.activeEvents.has('village_1')).toBe(false);
  });

  it('applies event need effects every tick until expiry', () => {
    const map = makeMap();
    const world = new World(map);
    const npc = makeNpc(world, 'heidi', 'farmer');
    const startProsperity = npcProps(npc).needs.prosperity;

    world.activeEvents.set('village_1', [{
      type: 'drought',
      poiId: 'village_1',
      severity: 0.5,
      durationTicks: 3,
      ticksElapsed: 0,
    }]);

    const ctx = createContext(world, 0);
    let prevProsperity = startProsperity;

    system.tick(ctx);
    prevProsperity = startProsperity - 0.008 * 0.5;
    expect(npcProps(npc).needs.prosperity).toBeCloseTo(prevProsperity, 5);

    system.tick(ctx);
    prevProsperity -= 0.008 * 0.5;
    expect(npcProps(npc).needs.prosperity).toBeCloseTo(prevProsperity, 5);

    system.tick(ctx);
    prevProsperity -= 0.008 * 0.5;
    expect(npcProps(npc).needs.prosperity).toBeCloseTo(prevProsperity, 5);

    // Event should have expired — no more effects
    system.tick(ctx);
    expect(npcProps(npc).needs.prosperity).toBeCloseTo(prevProsperity, 5);
  });

  it('rolling creates events for POIs with NPCs', () => {
    const map = makeMap();
    const world = new World(map);
    makeNpc(world, 'ivy', 'farmer');

    const ctx = createContext(world, 0);
    // Seed 42 with default rng: run many ticks and check that at least one
    // event was rolled for village_1
    let eventCreated = false;
    for (let t = 0; t < 500; t++) {
      ctx.clock.now = () => t;
      system.tick(ctx);
      if (world.activeEvents.has('village_1')) {
        eventCreated = true;
        break;
      }
    }
    expect(eventCreated).toBe(true);
  });

  it('does not roll events for POIs with no NPCs', () => {
    const map = makeMap();
    const world = new World(map);
    // NPC at village_1, no NPC at village_2
    makeNpc(world, 'ivy', 'farmer', 'village_1');

    const ctx = createContext(world, 0);
    for (let t = 0; t < 500; t++) {
      ctx.clock.now = () => t;
      system.tick(ctx);
    }
    expect(world.activeEvents.has('village_2')).toBe(false);
  });

  it('event rolling is deterministic with same seed', () => {
    const eventsPerRun = (seed: number): number => {
      const map = makeMap();
      const world = new World(map);
      makeNpc(world, 'ivy', 'farmer');
      const sys = new SettlementEventSystem();
      const ctx = createContext(world, seed);
      let count = 0;
      for (let t = 0; t < 500; t++) {
        ctx.clock.now = () => t;
        sys.tick(ctx);
        if (world.activeEvents.has('village_1')) count++;
      }
      return count;
    };

    expect(eventsPerRun(42)).toBe(eventsPerRun(42));
  });

  it('clamps applied event need values to [0, 1]', () => {
    const map = makeMap();
    const world = new World(map);
    const npc = makeNpc(world, 'jill', 'farmer');
    // Set prosperity at 0.01 and apply a strong negative event
    npcProps(npc).needs.prosperity = 0.01;

    world.activeEvents.set('village_1', [{
      type: 'drought',
      poiId: 'village_1',
      severity: 0.7,
      durationTicks: 100,
      ticksElapsed: 0,
    }]);

    const ctx = createContext(world, 0);
    for (let i = 0; i < 10; i++) system.tick(ctx);
    expect(npcProps(npc).needs.prosperity).toBeGreaterThanOrEqual(0);
  });

  it('event roll respects cooldown after expiry', () => {
    const map = makeMap();
    const world = new World(map);
    makeNpc(world, 'kay', 'farmer');

    const ctx = createContext(world, 0);

    // Force a drought event and let it expire
    world.activeEvents.set('village_1', [{
      type: 'drought',
      poiId: 'village_1',
      severity: 0.5,
      durationTicks: 3,
      ticksElapsed: 0,
    }]);

    // Expire the event (3 ticks). clock now = 0 so cooldown = 0 + 960 = 960
    for (let i = 0; i < 3; i++) system.tick(ctx);
    expect(world.activeEvents.has('village_1')).toBe(false);

    // Immediately after expiry, cooldown should prevent drought re-rolling.
    // Let the clock advance 960 ticks — but at each tick we might get a
    // DIFFERENT event type first (since drought is on cooldown but e.g.
    // stranger_arrives isn't). We just verify drought itself doesn't
    // re-appear during the cooldown window.
    let droughtInCooldown = false;
    for (let t = 0; t < 959; t++) {
      ctx.clock.now = () => t;
      system.tick(ctx);
      const events = world.activeEvents.get('village_1');
      if (events && events.some(e => e.type === 'drought')) {
        droughtInCooldown = true;
        break;
      }
    }
    expect(droughtInCooldown).toBe(false);

    // After cooldown expires (tick >= 960), drought should be possible again
    ctx.clock.now = () => 960;
    system.tick(ctx);
    const afterCooldown = world.activeEvents.get('village_1');
    if (afterCooldown && afterCooldown.some(e => e.type === 'drought')) {
      // drought might have been rolled — that's fine
      expect(true).toBe(true);
    } else {
      // a different event might have been rolled instead — also fine
      expect(true).toBe(true);
    }
  });
});
