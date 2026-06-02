import { describe, it, expect } from 'vitest';
import { buildInspectorTree, filterTree } from '@/dev/inspector/inspector-tree';
import { World } from '@/world/world';
import type { WorldSeed, GameMap, Entity } from '@/core/types';
import type { Spirit, SpiritId } from '@/core/spirit';

function emptyMap(): GameMap {
  return { tiles: [], width: 32, height: 32, villages: [], seed: 1, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] } as unknown as GameMap;
}

function tinyWorld(): World {
  const w = new World(emptyMap());
  w.addEntity({ id: 'npc_1', kind: 'npc', x: 1, y: 1, properties: { name: 'Ada', role: 'farmer' }, tags: ['npc'] } as Entity);
  w.addEntity({ id: 'tree_1', kind: 'tree', x: 2, y: 2, properties: {}, tags: ['vegetation'] } as Entity);
  return w;
}
const seed = { name: 'Testlandia', size: { width: 8, height: 8 }, biome: 'temperate', pois: [], connections: [], constraints: [] } as unknown as WorldSeed;
const spirits = new Map<SpiritId, Spirit>([['player', { id: 'player', name: 'You', sigil: '☼', color: '#fff', isPlayer: true, power: 5, manifestation: null } as Spirit]]);

describe('buildInspectorTree', () => {
  it('produces a World root with the expected branches', () => {
    const root = buildInspectorTree(tinyWorld(), null, spirits, [], seed);
    expect(root.label).toContain('Testlandia');
    const ids = (root.children ?? []).map(c => c.id);
    expect(ids).toEqual(expect.arrayContaining(['seed', 'lore', 'pois', 'kinds', 'spirits']));
  });

  it('groups entities by kind with counts and entity leaves', () => {
    const root = buildInspectorTree(tinyWorld(), null, spirits, [], seed);
    const kinds = (root.children ?? []).find(c => c.id === 'kinds');
    const npcGroup = (kinds?.children ?? []).find(c => c.id === 'kind:npc');
    expect(npcGroup?.label).toContain('npc');
    expect(npcGroup?.label).toContain('1');
    const leaf = (npcGroup?.children ?? [])[0];
    expect(leaf.selection).toEqual({ type: 'entity', id: 'npc_1' });
  });

  it('null world yields a single "No world loaded" root', () => {
    const root = buildInspectorTree(null, null, new Map(), [], null);
    expect(root.label).toContain('No world');
    expect(root.children ?? []).toHaveLength(0);
  });
});

describe('filterTree', () => {
  it('keeps nodes whose label or descendant matches; null if none', () => {
    const root = buildInspectorTree(tinyWorld(), null, spirits, [], seed);
    const filtered = filterTree(root, 'npc_1');
    expect(filtered).not.toBeNull();
    const kinds = (filtered!.children ?? []).find(c => c.id === 'kinds');
    expect(kinds).toBeDefined();
    expect(filterTree(root, 'zzzz-no-match')).toBeNull();
  });
});
