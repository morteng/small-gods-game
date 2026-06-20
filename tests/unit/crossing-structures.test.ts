import { describe, it, expect } from 'vitest';
import { buildCrossingStructureEntities } from '@/world/connectome/crossing-structures';
import type { RoadGraph, RoadEdge } from '@/world/road-graph';

const W = 24;
function edge(id: string, polyline: { x: number; y: number }[], partial: Partial<RoadEdge> = {}): RoadEdge {
  return { id, a: `${id}-a`, b: `${id}-b`, polyline, feature: 'road', class: 'road', surface: 'dirt', bridgeCells: [], ...partial };
}

describe('buildCrossingStructureEntities', () => {
  it('spawns grey-massing building entities for a rich crossing', () => {
    const poly = [8, 9, 10, 11, 12, 13].map((x) => ({ x, y: 10 }));
    const graph: RoadGraph = { nodes: [], edges: [edge('e', poly, { class: 'highway', bridgeCells: [10 * W + 10, 10 * W + 11] })] };
    const ents = buildCrossingStructureEntities(graph, W, { defaults: { era: 'late-medieval', prosperity: 'rich' } });
    // toll/guard/shrine/shop×2/gatehouse/mill → real entities, each grey-massing buildings.
    expect(ents.length).toBeGreaterThanOrEqual(5);
    // entity.kind is the preset; every one is a known building preset.
    const kinds = new Set(ents.map((e) => e.kind));
    expect(kinds.has('shrine')).toBe(true);
    expect(kinds.has('guard_post')).toBe(true);
    expect(ents.every((e) => (e.properties as any).category === 'building')).toBe(true);
    // positioned at real tiles
    expect(ents.every((e) => Number.isInteger(e.x) && Number.isInteger(e.y))).toBe(true);
  });

  it('a poor footpath crossing spawns no structures (bare footbridge)', () => {
    const poly = [4, 5, 6, 7].map((x) => ({ x, y: 4 }));
    const graph: RoadGraph = { nodes: [], edges: [edge('e', poly, { class: 'path', bridgeCells: [4 * W + 5] })] };
    const ents = buildCrossingStructureEntities(graph, W, { defaults: { era: 'stone-age', prosperity: 'poor' } });
    expect(ents).toHaveLength(0);
  });

  it('is deterministic', () => {
    const poly = [8, 9, 10, 11, 12].map((x) => ({ x, y: 6 }));
    const graph: RoadGraph = { nodes: [], edges: [edge('e', poly, { class: 'road', bridgeCells: [6 * W + 10] })] };
    const a = buildCrossingStructureEntities(graph, W);
    const b = buildCrossingStructureEntities(graph, W);
    expect(a.map((e) => `${e.kind}@${e.x},${e.y}`)).toEqual(b.map((e) => `${e.kind}@${e.x},${e.y}`));
  });
});
