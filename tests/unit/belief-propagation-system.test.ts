import { describe, it, expect, beforeEach } from 'vitest';
import { BeliefPropagationSystem } from '@/sim/systems/belief-propagation-system';
import { seedSocialGraph } from '@/sim/social-graph';
import { initNpcProps, npcProps } from '@/world/npc-helpers';
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

function makeNpc(world: World, id: string, role: 'farmer' | 'priest' | 'merchant' | 'elder' = 'farmer', homePoi = 'village_1', homeBldg = 'house_1', overrides?: Partial<ReturnType<typeof initNpcProps>>): Entity {
  const props = initNpcProps(id, role, id.charCodeAt(0) * 37);
  props.homePoiId = homePoi;
  props.homeBuildingId = homeBldg;
  if (overrides) Object.assign(props, overrides);
  // Apply personality overrides within the nested object
  if (overrides?.personality) Object.assign(props.personality, overrides.personality);
  if (overrides?.beliefs) Object.assign(props.beliefs, overrides.beliefs);
  const e: Entity = { id, kind: 'npc', x: 0, y: 0, properties: props as unknown as Record<string, unknown> };
  world.addEntity(e);
  return e;
}

function createContext(world: World, seed = 42) {
  const clock = { now: () => 0, advance: () => {} } as any;
  const log = new SilentEventLog(null as any);
  const rng = createRng(seed);
  return {
    world,
    spirits: new Map(),
    log,
    clock,
    rng,
    dt: 1000,
    now: 0,
  };
}

describe('BeliefPropagationSystem', () => {
  let system: BeliefPropagationSystem;

  beforeEach(() => {
    system = new BeliefPropagationSystem();
  });

  it('leaves faith unchanged when sociability is 0', () => {
    const map = makeMap();
    const world = new World(map);
    const a = makeNpc(world, 'a', 'farmer', 'village_1', 'house_1', { personality: { assertiveness: 0.5, skepticism: 0.5, piety: 0.3, sociability: 0 } });
    const b = makeNpc(world, 'b', 'priest', 'village_1', 'house_1', { personality: { assertiveness: 0.5, skepticism: 0.1, piety: 0.3, sociability: 1 }, beliefs: { player: { faith: 0.8, understanding: 0.5, devotion: 0.3 } } });
    const all = [...world.query({ kind: 'npc' })];
    seedSocialGraph(all, 42);

    const initialFaith = npcProps(a).beliefs.player?.faith ?? 0;
    system.tick(createContext(world));
    // Faith unchanged because NPC a's sociability is 0, so it never socializes
    expect(npcProps(a).beliefs.player?.faith).toBe(initialFaith);
  });

  it('does nothing when NPC has no relationships', () => {
    const map = makeMap();
    const world = new World(map);
    const a = makeNpc(world, 'a', 'farmer', 'village_1', 'house_1', { personality: { assertiveness: 0.5, skepticism: 0.5, piety: 0.3, sociability: 1 } });
    npcProps(a).beliefs = { player: { faith: 0.5, understanding: 0.3, devotion: 0.1 } };

    system.tick(createContext(world));
    // No crash — no relationships, no propagation
    expect(npcProps(a).beliefs.player.faith).toBe(0.5);
  });

  it('propagates faith/understanding/devotion along relationship edges', () => {
    const map = makeMap();
    const world = new World(map);
    const a = makeNpc(world, 'a', 'farmer', 'village_1', 'house_1', { personality: { assertiveness: 0.5, skepticism: 0.1, piety: 0.3, sociability: 1 } });
    const b = makeNpc(world, 'b', 'priest', 'village_1', 'house_1');
    const all = [...world.query({ kind: 'npc' })];
    seedSocialGraph(all, 42);
    // Give NPC b strong belief in player
    npcProps(b).beliefs = { player: { faith: 0.9, understanding: 0.7, devotion: 0.5 } };
    // Give NPC a an initial small belief so the threshold is met on b's side
    npcProps(a).beliefs = { player: { faith: 0.1, understanding: 0.05, devotion: 0.02 } };

    // Run many ticks to increase odds of a socialization event firing
    // with sociability=1, each tick has 40% chance
    const ctx = createContext(world, 42);
    for (let i = 0; i < 100; i++) {
      ctx.rng = createRng(42 + i);
      system.tick(ctx);
    }

    expect(npcProps(a).beliefs.player.faith).toBeGreaterThan(0.1);
    expect(npcProps(a).beliefs.player.understanding).toBeGreaterThan(0.05);
    expect(npcProps(a).beliefs.player.devotion).toBeGreaterThan(0.02);
  });

  it('seeds a new belief when neighbor believes in an unknown spirit', () => {
    const map = makeMap();
    const world = new World(map);
    const a = makeNpc(world, 'a', 'farmer', 'village_1', 'house_1', { personality: { assertiveness: 0.5, skepticism: 0.1, piety: 0.3, sociability: 1 } });
    const b = makeNpc(world, 'b', 'priest', 'village_1', 'house_1');
    const all = [...world.query({ kind: 'npc' })];
    seedSocialGraph(all, 42);
    // NPC a has no belief in 'player', but b does
    npcProps(a).beliefs = {}; // no player belief
    npcProps(b).beliefs = { player: { faith: 0.9, understanding: 0.7, devotion: 0.5 } };

    const ctx = createContext(world, 99);
    for (let i = 0; i < 100; i++) {
      ctx.rng = createRng(99 + i);
      system.tick(ctx);
    }

    // NPC a should now have a player belief entry
    expect(npcProps(a).beliefs.player).toBeDefined();
    if (npcProps(a).beliefs.player) {
      expect(npcProps(a).beliefs.player.faith).toBeGreaterThan(0);
    }
  });

  it('does not propagate when neighbor faith is below threshold', () => {
    const map = makeMap();
    const world = new World(map);
    const a = makeNpc(world, 'a', 'farmer', 'village_1', 'house_1', { personality: { assertiveness: 0.5, skepticism: 0.1, piety: 0.3, sociability: 1 } });
    const b = makeNpc(world, 'b', 'priest', 'village_1', 'house_1');
    const all = [...world.query({ kind: 'npc' })];
    seedSocialGraph(all, 42);
    // Neighbor faith is below 0.3 threshold
    npcProps(b).beliefs = { player: { faith: 0.2, understanding: 0.1, devotion: 0.05 } };
    npcProps(a).beliefs = { player: { faith: 0.1, understanding: 0.05, devotion: 0.02 } };

    const ctx = createContext(world, 42);
    for (let i = 0; i < 100; i++) {
      ctx.rng = createRng(42 + i);
      system.tick(ctx);
    }

    // Should not have changed because neighbor faith is below 0.3
    expect(npcProps(a).beliefs.player.faith).toBeCloseTo(0.1, 5);
  });

  it('faith is clamped to [0, 1]', () => {
    const map = makeMap();
    const world = new World(map);
    const a = makeNpc(world, 'a', 'farmer', 'village_1', 'house_1', { personality: { assertiveness: 0.5, skepticism: 0, piety: 0.3, sociability: 1 } });
    const b = makeNpc(world, 'b', 'priest', 'village_1', 'house_1');
    const all = [...world.query({ kind: 'npc' })];
    seedSocialGraph(all, 42);
    npcProps(a).beliefs = { player: { faith: 0.99, understanding: 0.99, devotion: 0.99 } };
    npcProps(b).beliefs = { player: { faith: 0.99, understanding: 0.99, devotion: 0.99 } };

    const ctx = createContext(world, 42);
    for (let i = 0; i < 100; i++) {
      ctx.rng = createRng(42 + i);
      system.tick(ctx);
    }

    expect(npcProps(a).beliefs.player.faith).toBeLessThanOrEqual(1);
    expect(npcProps(a).beliefs.player.understanding).toBeLessThanOrEqual(1);
    expect(npcProps(a).beliefs.player.devotion).toBeLessThanOrEqual(1);
    expect(npcProps(b).beliefs.player.faith).toBeLessThanOrEqual(1);
  });

  it('is deterministic — same seed same propagation result', () => {
    const run = (seed: number) => {
      const map = makeMap();
      const world = new World(map);
      const a = makeNpc(world, 'a', 'farmer', 'village_1', 'house_1', { personality: { assertiveness: 0.5, skepticism: 0.1, piety: 0.3, sociability: 1 } });
      const b = makeNpc(world, 'b', 'priest', 'village_1', 'house_1');
      const all = [...world.query({ kind: 'npc' })];
      seedSocialGraph(all, 42);
      npcProps(b).beliefs = { player: { faith: 0.9, understanding: 0.7, devotion: 0.5 } };
      npcProps(a).beliefs = { player: { faith: 0.1, understanding: 0.05, devotion: 0.02 } };

      const sys = new BeliefPropagationSystem();
      for (let i = 0; i < 50; i++) {
        const ctx = createContext(world, seed * 1000 + i);
        ctx.rng = createRng(seed * 1000 + i);
        sys.tick(ctx);
      }
      return {
        faith: npcProps(a).beliefs.player.faith,
        understanding: npcProps(a).beliefs.player.understanding,
        devotion: npcProps(a).beliefs.player.devotion,
      };
    };

    const r1 = run(42);
    const r2 = run(42);
    expect(r1).toEqual(r2);
  });
});
