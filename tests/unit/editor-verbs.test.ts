import { describe, it, expect } from 'vitest';
import { executeCommand } from '@/sim/command/command-system';
import type { ApplyCtx, Command } from '@/sim/command/types';
import { World } from '@/world/world';
import { SimClock } from '@/core/clock';
import { EventLog } from '@/core/events';
import { createRng } from '@/core/rng';
import { initNpcProps, queryNpcs } from '@/world/npc-helpers';
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
