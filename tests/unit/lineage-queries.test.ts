import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import { SimClock } from '@/core/clock';
import { EventLog } from '@/core/events';
import { createRng } from '@/core/rng';
import { initNpcProps, npcProps, getParents, getChildren, lineageMembers } from '@/world/npc-helpers';
import { birthNpc, killNpc } from '@/world/npc-lifecycle';
import type { GameMap, Entity } from '@/core/types';

function emptyMap(): GameMap {
  return { tiles: [], width: 32, height: 32, villages: [], seed: 1, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] } as unknown as GameMap;
}
function addFounder(world: World, id: string): Entity {
  const p = initNpcProps(id, 'farmer', 7);
  p.lineageId = id;
  const e: Entity = { id, kind: 'npc', x: 1, y: 1, properties: p as unknown as Record<string, unknown> };
  world.addEntity(e);
  return e;
}

describe('lineage queries', () => {
  it('getParents maps a child back to its parent entities', () => {
    const world = new World(emptyMap());
    const mum = addFounder(world, 'mum'); const dad = addFounder(world, 'dad');
    const log = new EventLog(new SimClock());
    const child = birthNpc(world, [mum, dad], 10, createRng(1), log);
    const parents = getParents(world, child).map(e => e.id).sort();
    expect(parents).toEqual(['dad', 'mum']);
  });

  it('getChildren finds entities whose parentIds include the given npc', () => {
    const world = new World(emptyMap());
    const mum = addFounder(world, 'mum');
    const log = new EventLog(new SimClock());
    const c1 = birthNpc(world, [mum], 10, createRng(1), log);
    const c2 = birthNpc(world, [mum], 20, createRng(2), log);
    const kids = getChildren(world, mum).map(e => e.id).sort();
    expect(kids).toEqual([c1.id, c2.id].sort());
  });

  it('lineageMembers includes living descendants AND remains sharing the root ancestor', () => {
    const world = new World(emptyMap());
    const mum = addFounder(world, 'mum');
    const log = new EventLog(new SimClock());
    const child = birthNpc(world, [mum], 10, createRng(1), log);
    killNpc(world, world.registry.get('mum')!, 50, 'old_age', log); // mum now remains
    const members = lineageMembers(world, 'mum').map(e => e.id).sort();
    expect(members).toEqual(['mum', child.id].sort()); // dead founder + living child
  });
});
