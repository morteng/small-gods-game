import { describe, it, expect } from 'vitest';
import { buildCandidateIds, resolveLinks } from '@/llm/mind-link-resolver';
import { World } from '@/world/world';
import type { Entity, GameMap } from '@/core/types';

function emptyMap(): GameMap {
  return { tiles: [], width: 32, height: 32, villages: [], seed: 1, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] } as unknown as GameMap;
}

function mkNpc(id: string, x: number, y: number, over: any = {}): Entity {
  return { id, kind: 'npc', x, y, properties: {
    name: id, role: 'farmer', relationships: [], recentEventIds: [], homePoiId: undefined, ...over,
  } } as unknown as Entity;
}

describe('buildCandidateIds', () => {
  it('includes relationship targets and home poi', () => {
    const w = new World(emptyMap());
    const tom = mkNpc('tom', 1, 1);
    w.addEntity(tom);
    const maeve = mkNpc('maeve', 1, 2, { relationships: [{ npcId: 'tom', type: 'family', trust: 0.8 }], homePoiId: 'poi_east' });
    w.addEntity(maeve);
    const cands = buildCandidateIds(maeve, w);
    const ids = cands.map(c => c.id);
    expect(ids).toContain('tom');
    expect(ids).toContain('poi_east');
  });
});

describe('resolveLinks', () => {
  const candidates = [
    { id: 'tom', label: 'Tom', kind: 'npc' as const },
    { id: 'poi_east', label: 'Easthollow', kind: 'place' as const },
  ];

  it('keeps a valid entity link as gold', () => {
    const out = resolveLinks([{ label: 'Tom', kind: 'entity', entityId: 'tom' }], candidates);
    expect(out[0]).toEqual({ label: 'Tom', kind: 'entity', entityId: 'tom' });
  });

  it('degrades an entity link with an unknown id to a concept link', () => {
    const out = resolveLinks([{ label: 'the stranger', kind: 'entity', entityId: 'ghost42' }], candidates);
    expect(out[0].kind).toBe('concept');
    expect(out[0].entityId).toBeUndefined();
  });

  it('passes concept links through unchanged', () => {
    const out = resolveLinks([{ label: 'fear of being forgotten', kind: 'concept' }], candidates);
    expect(out[0]).toEqual({ label: 'fear of being forgotten', kind: 'concept' });
  });

  it('degrades an entity link missing an id to concept', () => {
    const out = resolveLinks([{ label: 'someone', kind: 'entity' }], candidates);
    expect(out[0].kind).toBe('concept');
  });
});
