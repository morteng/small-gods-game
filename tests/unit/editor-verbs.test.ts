import { describe, it, expect } from 'vitest';
import { executeCommand } from '@/sim/command/command-system';
import type { ApplyCtx, Command } from '@/sim/command/types';
import { World } from '@/world/world';
import { SimClock } from '@/core/clock';
import { EventLog } from '@/core/events';
import { createRng } from '@/core/rng';
import { initNpcProps, npcProps, queryNpcs } from '@/world/npc-helpers';
import type { Entity, GameMap, NpcProperties } from '@/core/types';
import type { Spirit, SpiritId } from '@/core/spirit';

function bigMap(n = 12): GameMap {
  const tiles: GameMap['tiles'] = [];
  for (let y = 0; y < n; y++) {
    const row = [];
    for (let x = 0; x < n; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
    tiles.push(row as never);
  }
  return { tiles, width: n, height: n, villages: [], seed: 1, success: true, worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] } as unknown as GameMap;
}

function applyCtx(world: World, now = 10): ApplyCtx {
  return { world, spirits: new Map<SpiritId, Spirit>(), log: new EventLog(new SimClock()), rng: createRng(42), now };
}

function npc(id: string, x: number, y: number, mut: (p: NpcProperties) => void = () => {}): Entity {
  const p = initNpcProps(id, 'farmer', 7);
  p.homeX = x; p.homeY = y; p.homePoiId = 'poi1';
  mut(p);
  return { id, kind: 'npc', x, y, properties: p as unknown as Record<string, unknown> };
}

function authorCmd(verb: Command['verb'], payload: Record<string, unknown>): Command {
  return { verb, source: 'author', target: { kind: 'none' }, payload, seq: 0 };
}

describe('author_remove_entity', () => {
  it('removes a single entity by id', () => {
    const world = new World(bigMap());
    world.addEntity(npc('n1', 2, 2));
    const res = executeCommand(authorCmd('author_remove_entity', { entityId: 'n1' }), applyCtx(world));
    expect(res.status).toBe('applied');
    expect(world.registry.get('n1')).toBeUndefined();
  });

  it('rejects a missing entityId with invalid_target', () => {
    const world = new World(bigMap());
    const res = executeCommand(authorCmd('author_remove_entity', { entityId: 'nope' }), applyCtx(world));
    expect(res).toMatchObject({ status: 'rejected', reason: 'invalid_target' });
  });

  it('removes all entities matching a {kind, role} filter', () => {
    const world = new World(bigMap());
    world.addEntity(npc('b1', 1, 1, p => { p.role = 'beggar'; }));
    world.addEntity(npc('b2', 2, 2, p => { p.role = 'beggar'; }));
    world.addEntity(npc('f1', 3, 3, p => { p.role = 'farmer'; }));
    const res = executeCommand(authorCmd('author_remove_entity', { filter: { kind: 'npc', role: 'beggar' } }), applyCtx(world));
    expect(res.status).toBe('applied');
    expect(queryNpcs(world).map(e => e.id).sort()).toEqual(['f1']);
  });

  it('rejects a payload with neither entityId nor filter as invalid_payload', () => {
    const world = new World(bigMap());
    const res = executeCommand(authorCmd('author_remove_entity', {}), applyCtx(world));
    expect(res).toMatchObject({ status: 'rejected', reason: 'invalid_payload' });
  });
});

describe('author_spawn_npc', () => {
  it('spawns `count` npcs near a resident of the given poiId, with belief overrides', () => {
    const world = new World(bigMap());
    world.addEntity(npc('anchor', 6, 6, p => { p.homePoiId = 'poi1'; }));
    const before = queryNpcs(world).length;

    const res = executeCommand(authorCmd('author_spawn_npc', {
      role: 'farmer', count: 3, near: 'poi1', faith: 0.9, understanding: 0.4, devotion: 0.2,
    }), applyCtx(world));

    expect(res.status).toBe('applied');
    const after = queryNpcs(world);
    expect(after.length).toBe(before + 3);
    const spawned = after.filter(e => e.id !== 'anchor');
    for (const e of spawned) {
      const b = npcProps(e).beliefs.player;
      expect(b.faith).toBeCloseTo(0.9);
      expect(b.understanding).toBeCloseTo(0.4);
      expect(b.devotion).toBeCloseTo(0.2);
      expect(npcProps(e).role).toBe('farmer');
      // placed on a distinct, walkable, unoccupied tile
      expect(world.tiles.tiles[e.y][e.x].walkable).toBe(true);
    }
    // distinct tiles
    const coords = new Set(spawned.map(e => `${e.x},${e.y}`));
    expect(coords.size).toBe(3);
  });

  it('spawns at explicit coords when near is {x,y}', () => {
    const world = new World(bigMap());
    const res = executeCommand(authorCmd('author_spawn_npc', { role: 'priest', near: { x: 5, y: 5 } }), applyCtx(world));
    expect(res.status).toBe('applied');
    expect(queryNpcs(world).length).toBe(1);
  });

  it('rejects when near is a poiId with no residents and no coords (invalid_target)', () => {
    const world = new World(bigMap());
    const res = executeCommand(authorCmd('author_spawn_npc', { role: 'farmer', near: 'ghost-town' }), applyCtx(world));
    expect(res).toMatchObject({ status: 'rejected', reason: 'invalid_target' });
  });

  it('rejects a missing role with invalid_payload', () => {
    const world = new World(bigMap());
    world.addEntity(npc('anchor', 6, 6));
    const res = executeCommand(authorCmd('author_spawn_npc', { near: 'poi1' }), applyCtx(world));
    expect(res).toMatchObject({ status: 'rejected', reason: 'invalid_payload' });
  });

  it('is deterministic: same rng seed → same spawned ids', () => {
    const ids = (seed: number) => {
      const world = new World(bigMap());
      world.addEntity(npc('anchor', 6, 6));
      executeCommand(authorCmd('author_spawn_npc', { role: 'farmer', count: 2, near: 'poi1' }),
        { world, spirits: new Map<SpiritId, Spirit>(), log: new EventLog(new SimClock()), rng: createRng(seed), now: 10 });
      return queryNpcs(world).filter(e => e.id !== 'anchor').map(e => e.id).sort();
    };
    expect(ids(123)).toEqual(ids(123));
  });
});

describe('author_modify_npc', () => {
  it('sets name, role, belief, mood, and activity on an existing npc', () => {
    const world = new World(bigMap());
    world.addEntity(npc('m1', 4, 4, p => { p.beliefs.player = { faith: 0.1, understanding: 0.1, devotion: 0.1 }; }));
    const res = executeCommand(authorCmd('author_modify_npc', {
      entityId: 'm1',
      set: { name: 'Brother Aldous', role: 'priest', faith: 0.95, understanding: 0.6, devotion: 0.7, mood: 0.8, activity: 'worship' },
    }), applyCtx(world));

    expect(res.status).toBe('applied');
    const p = npcProps(world.registry.get('m1')!);
    expect(p.name).toBe('Brother Aldous');
    expect(p.role).toBe('priest');
    expect(p.beliefs.player.faith).toBeCloseTo(0.95);
    expect(p.beliefs.player.understanding).toBeCloseTo(0.6);
    expect(p.beliefs.player.devotion).toBeCloseTo(0.7);
    expect(p.mood).toBeCloseTo(0.8);
    expect(p.activity).toBe('worship');
  });

  it('rejects a missing entity with invalid_target', () => {
    const world = new World(bigMap());
    const res = executeCommand(authorCmd('author_modify_npc', { entityId: 'ghost', set: { faith: 0.5 } }), applyCtx(world));
    expect(res).toMatchObject({ status: 'rejected', reason: 'invalid_target' });
  });

  it('rejects a non-npc target with invalid_target', () => {
    const world = new World(bigMap());
    world.addEntity({ id: 'rock', kind: 'boulder', x: 1, y: 1 });
    const res = executeCommand(authorCmd('author_modify_npc', { entityId: 'rock', set: { faith: 0.5 } }), applyCtx(world));
    expect(res).toMatchObject({ status: 'rejected', reason: 'invalid_target' });
  });

  it('rejects an empty/missing set with invalid_payload', () => {
    const world = new World(bigMap());
    world.addEntity(npc('m2', 4, 4));
    const res = executeCommand(authorCmd('author_modify_npc', { entityId: 'm2' }), applyCtx(world));
    expect(res).toMatchObject({ status: 'rejected', reason: 'invalid_payload' });
  });
});

describe('author_place_object', () => {
  it('places `count` objects of a valid kind near (x,y) on distinct tiles', () => {
    const world = new World(bigMap());
    // 'well' is a real prop kind in entity-kinds.ts
    const res = executeCommand(authorCmd('author_place_object', { kind: 'well', x: 5, y: 5, count: 2 }), applyCtx(world));
    expect(res.status).toBe('applied');
    const placed = world.query({ kind: 'well' });
    expect(placed.length).toBe(2);
    const coords = new Set(placed.map(e => `${e.x},${e.y}`));
    expect(coords.size).toBe(2);
  });

  it('rejects an unknown kind with invalid_payload', () => {
    const world = new World(bigMap());
    const res = executeCommand(authorCmd('author_place_object', { kind: 'not_a_kind', x: 2, y: 2 }), applyCtx(world));
    expect(res).toMatchObject({ status: 'rejected', reason: 'invalid_payload' });
  });
});

describe('author_move_entity', () => {
  it('moves an entity to new coords and keeps the spatial index in sync', () => {
    const world = new World(bigMap());
    world.addEntity(npc('mv', 1, 1));
    const res = executeCommand(authorCmd('author_move_entity', { entityId: 'mv', to: { x: 7, y: 8 } }), applyCtx(world));
    expect(res.status).toBe('applied');
    const e = world.registry.get('mv')!;
    expect([e.x, e.y]).toEqual([7, 8]);
    // spatial index reflects the move (query the new region finds it, old does not)
    expect(world.query({ region: { x: 7, y: 8, w: 1, h: 1 } }).map(x => x.id)).toContain('mv');
    expect(world.query({ region: { x: 1, y: 1, w: 1, h: 1 } }).map(x => x.id)).not.toContain('mv');
  });

  it('rejects a missing entity with invalid_target', () => {
    const world = new World(bigMap());
    const res = executeCommand(authorCmd('author_move_entity', { entityId: 'ghost', to: { x: 2, y: 2 } }), applyCtx(world));
    expect(res).toMatchObject({ status: 'rejected', reason: 'invalid_target' });
  });

  it('rejects out-of-bounds coords with invalid_payload', () => {
    const world = new World(bigMap());
    world.addEntity(npc('mv2', 1, 1));
    const res = executeCommand(authorCmd('author_move_entity', { entityId: 'mv2', to: { x: 999, y: 0 } }), applyCtx(world));
    expect(res).toMatchObject({ status: 'rejected', reason: 'invalid_payload' });
  });

  it('rejects moving onto a non-realized/void tile with invalid_payload', () => {
    const map = bigMap();
    map.tiles[3][3] = { type: 'void', x: 3, y: 3, walkable: false, state: 'void' } as never;
    const world = new World(map);
    world.addEntity(npc('mv3', 1, 1));
    const res = executeCommand(authorCmd('author_move_entity', { entityId: 'mv3', to: { x: 3, y: 3 } }), applyCtx(world));
    expect(res).toMatchObject({ status: 'rejected', reason: 'invalid_payload' });
    expect(world.registry.get('mv3')).toMatchObject({ x: 1, y: 1 }); // unmoved
  });
});

describe('author_set_climate', () => {
  function mapWithSeed(): GameMap {
    const m = bigMap();
    (m as { worldSeed: unknown }).worldSeed = { name: 'T', size: { width: 12, height: 12 }, biome: 'temperate', pois: [], connections: [], constraints: [] };
    return m;
  }

  it('sets worldSeed.climate to a valid named zone', () => {
    const world = new World(mapWithSeed());
    const res = executeCommand(authorCmd('author_set_climate', { climate: 'arctic' }), applyCtx(world));
    expect(res.status).toBe('applied');
    expect(world.tiles.worldSeed!.climate).toBe('arctic');
  });

  it('rejects an unknown climate name with invalid_payload', () => {
    const world = new World(mapWithSeed());
    const res = executeCommand(authorCmd('author_set_climate', { climate: 'martian' }), applyCtx(world));
    expect(res).toMatchObject({ status: 'rejected', reason: 'invalid_payload' });
    expect(world.tiles.worldSeed!.climate).toBeUndefined();
  });

  it('rejects when the world has no seed to re-zone (invalid_target)', () => {
    const world = new World(bigMap()); // worldSeed: null
    const res = executeCommand(authorCmd('author_set_climate', { climate: 'tropical' }), applyCtx(world));
    expect(res).toMatchObject({ status: 'rejected', reason: 'invalid_target' });
  });
});
