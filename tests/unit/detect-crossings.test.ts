import { describe, it, expect } from 'vitest';
import { detectCrossings } from '@/world/connectome/detect-crossings';
import { buildCrossing } from '@/world/connectome/crossing-builder';
import { collectByKind } from '@/world/connectome/world-node';
import type { RoadGraph, RoadEdge } from '@/world/road-graph';

const W = 24;
function edge(id: string, polyline: { x: number; y: number }[], partial: Partial<RoadEdge> = {}): RoadEdge {
  return { id, a: `${id}-a`, b: `${id}-b`, polyline, feature: 'road', class: 'road', surface: 'dirt', bridgeCells: [], ...partial };
}

describe('detectCrossings', () => {
  it('emits one spec per contiguous bridge-cell run, with span + class + banks', () => {
    // Road along row 10, x=4..9; cells 6,7 are bridged (a 2-tile crossing).
    const poly = [4, 5, 6, 7, 8, 9].map((x) => ({ x, y: 10 }));
    const graph: RoadGraph = { nodes: [], edges: [edge('e', poly, { class: 'highway', bridgeCells: [10 * W + 6, 10 * W + 7] })] };
    const specs = detectCrossings(graph, W);
    expect(specs).toHaveLength(1);
    expect(specs[0].spanTiles).toBe(2);
    expect(specs[0].roadClass).toBe('highway');
    expect(specs[0].banks).toEqual([{ x: 5, y: 10 }, { x: 8, y: 10 }]); // flanking approaches
    expect(specs[0].waterRef).toContain('water@');
  });

  it('separates two distinct crossings on the same road', () => {
    const poly = Array.from({ length: 12 }, (_, x) => ({ x, y: 5 }));
    const graph: RoadGraph = { nodes: [], edges: [edge('e', poly, { bridgeCells: [5 * W + 3, 5 * W + 7, 5 * W + 8] })] };
    const specs = detectCrossings(graph, W);
    expect(specs).toHaveLength(2);
    expect(specs.map((s) => s.spanTiles).sort()).toEqual([1, 2]);
  });

  it('ignores rivers, walls, and edges with no bridge cells', () => {
    const graph: RoadGraph = {
      nodes: [], edges: [
        edge('r', [{ x: 1, y: 1 }, { x: 2, y: 1 }], { feature: 'river', bridgeCells: [W + 1] }),
        edge('dry', [{ x: 1, y: 3 }, { x: 2, y: 3 }]),
      ],
    };
    expect(detectCrossings(graph, W)).toHaveLength(0);
  });

  it('pulls site params from the resolver at the run midpoint → drives the built site', () => {
    const poly = [4, 5, 6, 7, 8].map((x) => ({ x, y: 12 }));
    const graph: RoadGraph = { nodes: [], edges: [edge('e', poly, { class: 'highway', bridgeCells: [12 * W + 6] })] };
    const specs = detectCrossings(graph, W, {
      siteParamsAt: () => ({ era: 'late-medieval', prosperity: 'rich', biome: 'river-meadow' }),
    });
    expect(specs[0].era).toBe('late-medieval');
    // Feeding the detected spec into the producer yields the rich inhabited site.
    const site = buildCrossing({ ...specs[0], spanTiles: 8 });
    expect(collectByKind(site, 'building').length).toBeGreaterThan(3); // shops+gate+toll+guard+shrine+mill
  });

  it('falls back to neutral defaults when no resolver is supplied', () => {
    const poly = [4, 5, 6].map((x) => ({ x, y: 2 }));
    const graph: RoadGraph = { nodes: [], edges: [edge('e', poly, { bridgeCells: [2 * W + 5] })] };
    const specs = detectCrossings(graph, W);
    expect(specs[0].era).toBe('early-medieval');
    expect(specs[0].prosperity).toBe('modest');
  });
});
