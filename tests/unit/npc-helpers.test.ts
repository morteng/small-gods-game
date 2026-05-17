import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import { getNpc, npcProps, queryNpcs, forEachNpc, toRenderNpc } from '@/world/npc-helpers';
import { initNpcProps } from '@/world/npc-helpers';
import type { GameMap, Entity } from '@/core/types';

function emptyMap(): GameMap {
  return {
    tiles: [], width: 10, height: 10, villages: [], seed: 1,
    success: true, worldSeed: null,
    stats: { iterations: 0, backtracks: 0 }, buildings: [],
  };
}

function makeNpcEntity(id: string, x: number, y: number): Entity {
  return {
    id, kind: 'npc', x, y,
    properties: initNpcProps('Alice', 'farmer', 42) as unknown as Record<string, unknown>,
  };
}

describe('npc-helpers', () => {
  it('getNpc returns undefined for missing id', () => {
    const w = new World(emptyMap());
    expect(getNpc(w, 'nope')).toBeUndefined();
  });

  it('getNpc returns the entity for an existing npc id', () => {
    const w = new World(emptyMap());
    w.addEntity(makeNpcEntity('n1', 0, 0));
    expect(getNpc(w, 'n1')?.id).toBe('n1');
  });

  it('npcProps narrows to NpcProperties', () => {
    const e = makeNpcEntity('n1', 0, 0);
    expect(npcProps(e).role).toBe('farmer');
  });

  it('queryNpcs returns only kind: npc entities', () => {
    const w = new World(emptyMap());
    w.addEntity(makeNpcEntity('n1', 0, 0));
    w.addEntity({ id: 'tree1', kind: 'oak_tree', x: 1, y: 1 });
    const npcs = queryNpcs(w);
    expect(npcs.map(e => e.id)).toEqual(['n1']);
  });

  it('queryNpcs supports region filter', () => {
    const w = new World(emptyMap());
    w.addEntity(makeNpcEntity('n1', 0, 0));
    w.addEntity(makeNpcEntity('n2', 5, 5));
    const npcs = queryNpcs(w, { region: { x: 4, y: 4, w: 3, h: 3 } });
    expect(npcs.map(e => e.id)).toEqual(['n2']);
  });

  it('forEachNpc visits every npc entity', () => {
    const w = new World(emptyMap());
    w.addEntity(makeNpcEntity('n1', 0, 0));
    w.addEntity(makeNpcEntity('n2', 1, 1));
    const ids: string[] = [];
    forEachNpc(w, e => ids.push(e.id));
    expect(ids.sort()).toEqual(['n1', 'n2']);
  });

  it('toRenderNpc adapts entity to legacy NpcInstance shape', () => {
    const e = makeNpcEntity('n1', 3, 4);
    const r = toRenderNpc(e);
    expect(r.id).toBe('n1');
    expect(r.tileX).toBe(3);
    expect(r.tileY).toBe(4);
    expect(r.role).toBe('farmer');
  });

  it('initNpcProps produces a complete properties object', () => {
    const p = initNpcProps('Bob', 'priest', 100);
    expect(p.name).toBe('Bob');
    expect(p.role).toBe('priest');
    expect(p.beliefs).toBeDefined();
    expect(p.needs).toBeDefined();
    expect(p.mood).toBeGreaterThanOrEqual(0);
    expect(p.recentEventIds).toEqual([]);
  });
});
