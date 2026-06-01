import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import { SimClock } from '@/core/clock';
import { EventLog, type SimEvent } from '@/core/events';
import { createRng } from '@/core/rng';
import { initNpcProps, npcProps, queryNpcs, REMAINS_KIND } from '@/world/npc-helpers';
import {
  killNpc, birthNpc, INHERIT_FAITH_FRAC, INHERIT_UNDERSTANDING_FRAC,
} from '@/world/npc-lifecycle';
import type { GameMap, Entity } from '@/core/types';

function emptyMap(): GameMap {
  return { tiles: [], width: 32, height: 32, villages: [], seed: 1, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] } as unknown as GameMap;
}
function addNpc(world: World, id: string, faith = 0.5, understanding = 0.6): Entity {
  const p = initNpcProps(id, 'farmer', 7);
  p.lineageId = id;
  p.beliefs['player'] = { faith, understanding, devotion: 0.1 };
  const e: Entity = { id, kind: 'npc', x: 3, y: 4, properties: p as unknown as Record<string, unknown> };
  world.addEntity(e);
  return e;
}
function newLog(clock: SimClock) {
  const log = new EventLog(clock);
  const events: SimEvent[] = [];
  log.subscribe((a) => events.push(a.event));
  return { log, events };
}

describe('killNpc', () => {
  it('converts npc -> remains: no longer an NPC, still present, identity preserved', () => {
    const world = new World(emptyMap());
    addNpc(world, 'tola');
    const clock = new SimClock(); const { log, events } = newLog(clock);

    killNpc(world, world.registry.get('tola')!, 1234, 'old_age', log);

    expect(queryNpcs(world).map(e => e.id)).not.toContain('tola');
    const e = world.registry.get('tola')!;
    expect(e.kind).toBe(REMAINS_KIND);
    expect(e.id).toBe('tola');
    expect(npcProps(e).lineageId).toBe('tola');
    expect(npcProps(e).deathTick).toBe(1234);
    expect(npcProps(e).deathCause).toBe('old_age');
    expect(events.some(ev => ev.type === 'npc_death' && ev.npcId === 'tola')).toBe(true);
  });

  it('is reachable via a region query as a remains entity', () => {
    const world = new World(emptyMap());
    addNpc(world, 'tola');
    const clock = new SimClock(); const { log } = newLog(clock);
    killNpc(world, world.registry.get('tola')!, 1, 'old_age', log);
    const found = world.query({ kind: REMAINS_KIND });
    expect(found.map(e => e.id)).toContain('tola');
  });
});

describe('birthNpc', () => {
  it('spawns a child with diluted faith, near-zero understanding, zero devotion', () => {
    const world = new World(emptyMap());
    const a = addNpc(world, 'mum', 0.8, 0.6);
    const b = addNpc(world, 'dad', 0.4, 0.4);
    npcProps(b).lineageId = 'mum'; // same house
    const clock = new SimClock(); const { log, events } = newLog(clock);
    const rng = createRng(42);

    const child = birthNpc(world, [a, b], 5000, rng, log);
    const cp = npcProps(child);

    expect(cp.parentIds).toEqual(['mum', 'dad']);
    expect(cp.lineageId).toBe('mum');
    expect(cp.birthTick).toBe(5000);
    const avgFaith = (0.8 + 0.4) / 2;       // 0.6
    const avgUnd = (0.6 + 0.4) / 2;         // 0.5
    expect(cp.beliefs['player'].faith).toBeCloseTo(INHERIT_FAITH_FRAC * avgFaith, 5);
    expect(cp.beliefs['player'].understanding).toBeCloseTo(INHERIT_UNDERSTANDING_FRAC * avgUnd, 5);
    expect(cp.beliefs['player'].devotion).toBe(0);
    expect(child.kind).toBe('npc');
    expect(events.some(ev => ev.type === 'npc_birth' && ev.npcId === child.id)).toBe(true);
  });

  it('supports a single parent (lineage carries through)', () => {
    const world = new World(emptyMap());
    const a = addNpc(world, 'solo', 0.5, 0.5);
    const clock = new SimClock(); const { log } = newLog(clock);
    const child = birthNpc(world, [a], 100, createRng(1), log);
    expect(npcProps(child).parentIds).toEqual(['solo']);
    expect(npcProps(child).lineageId).toBe('solo');
  });

  it('generates unique child ids (no collision across multiple births)', () => {
    const world = new World(emptyMap());
    const a = addNpc(world, 'mum'); const b = addNpc(world, 'dad');
    const clock = new SimClock(); const { log } = newLog(clock);
    const rng = createRng(7);
    const ids = new Set<string>();
    for (let i = 0; i < 20; i++) ids.add(birthNpc(world, [a, b], 1000 + i, rng, log).id);
    expect(ids.size).toBe(20);
  });
});
