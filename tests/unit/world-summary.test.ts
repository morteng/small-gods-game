import { describe, it, expect } from 'vitest';
import { buildWorldSummary } from '@/llm/world-summary';
import { World } from '@/world/world';
import { initNpcProps } from '@/world/npc-helpers';
import type { GameState } from '@/core/state';
import type { GameMap, NpcProperties } from '@/core/types';

function map(): GameMap {
  return { tiles: [[{ type: 'grass', x: 0, y: 0, walkable: true, state: 'realized' }]], width: 8, height: 8, villages: [], seed: 1, success: true, worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] } as unknown as GameMap;
}

function npc(id: string, role: string, poi: string, name: string) {
  const p = initNpcProps(name, role as NpcProperties['role'], 7);
  p.homePoiId = poi;
  return { id, kind: 'npc', x: 1, y: 1, properties: p as unknown as Record<string, unknown> };
}

function state(): GameState {
  const world = new World(map());
  world.addEntity(npc('n1', 'priest', 'northvale', 'Aldous'));
  world.addEntity(npc('n2', 'farmer', 'northvale', 'Bryn'));
  return {
    world,
    worldSeed: { name: 'Testlands', size: { width: 8, height: 8 }, pois: [{ id: 'northvale', name: 'Northvale', type: 'village', position: { x: 3, y: 4 } }] },
  } as unknown as GameState;
}

describe('buildWorldSummary', () => {
  it('names the world, lists settlements with ids+coords, and population', () => {
    const s = buildWorldSummary(state());
    expect(s).toContain('Testlands');
    expect(s).toContain('northvale');
    expect(s).toContain('Northvale');
    expect(s).toContain('(3,4)');
    expect(s).toMatch(/2 NPC/);
  });

  it('includes a roster sample with id, name, role, and home', () => {
    const s = buildWorldSummary(state());
    expect(s).toContain('n1');
    expect(s).toContain('Aldous');
    expect(s).toContain('priest');
  });

  it('does not throw on a null world / missing worldSeed', () => {
    expect(() => buildWorldSummary({ world: null, worldSeed: null } as unknown as GameState)).not.toThrow();
  });
});
