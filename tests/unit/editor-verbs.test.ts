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
