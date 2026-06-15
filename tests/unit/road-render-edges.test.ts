import { describe, it, expect } from 'vitest';
import type { Region } from '@/core/types';
import type { RoadGraph } from '@/world/road-graph';
import { projectRoadEdges } from '@/render/graph/world-render-graph';

const FULL: Region = { x: 0, y: 0, w: 100, h: 100 };

function graph(edges: RoadGraph['edges']): RoadGraph {
  return { nodes: [], edges };
}

describe('projectRoadEdges', () => {
  it('returns [] for an undefined or empty graph', () => {
    expect(projectRoadEdges(undefined, FULL)).toEqual([]);
    expect(projectRoadEdges(graph([]), FULL)).toEqual([]);
  });

  it('projects a road edge to a RenderEdge (kind/width/material/polyline)', () => {
    const g = graph([{
      id: 're0', a: 'n0', b: 'n1', feature: 'road', class: 'road', surface: 'dirt',
      bridgeCells: [], polyline: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }],
    }]);
    const [edge] = projectRoadEdges(g, FULL);
    expect(edge.kind).toBe('road');
    expect(edge.width).toBe(1);
    expect(edge.material).toBe('dirt');
    expect(edge.polyline).toEqual([[0, 0], [1, 0], [2, 0]]);
  });

  it('maps feature + class to kind and width', () => {
    const g = graph([
      { id: 'r', a: 'a', b: 'b', feature: 'road', class: 'highway', surface: 'stone',
        bridgeCells: [], polyline: [{ x: 0, y: 0 }] },
      { id: 'v', a: 'c', b: 'd', feature: 'river', class: 'road', surface: 'water',
        bridgeCells: [], polyline: [{ x: 1, y: 1 }] },
      { id: 'w', a: 'e', b: 'f', feature: 'wall', class: 'road', surface: 'stone',
        bridgeCells: [], polyline: [{ x: 2, y: 2 }] },
    ]);
    const out = projectRoadEdges(g, FULL);
    expect(out.map(e => [e.kind, e.width, e.material])).toEqual([
      ['road', 2, 'stone'],   // highway road
      ['river', 1.2, 'water'],
      ['wall', 0.5, 'stone'],
    ]);
  });

  it('region-culls edges whose bounding box does not overlap', () => {
    const g = graph([
      { id: 'in', a: 'a', b: 'b', feature: 'road', class: 'road', surface: 'dirt',
        bridgeCells: [], polyline: [{ x: 1, y: 1 }, { x: 3, y: 1 }] },
      { id: 'out', a: 'c', b: 'd', feature: 'road', class: 'road', surface: 'dirt',
        bridgeCells: [], polyline: [{ x: 50, y: 50 }, { x: 60, y: 50 }] },
    ]);
    const region: Region = { x: 0, y: 0, w: 5, h: 5 };
    const out = projectRoadEdges(g, region);
    expect(out).toHaveLength(1);
    expect(out[0].polyline[0]).toEqual([1, 1]);
  });

  it('keeps an edge that merely clips the region corner', () => {
    const g = graph([{
      id: 'clip', a: 'a', b: 'b', feature: 'road', class: 'road', surface: 'dirt',
      bridgeCells: [], polyline: [{ x: 4, y: 4 }, { x: 20, y: 20 }],
    }]);
    const region: Region = { x: 0, y: 0, w: 5, h: 5 };
    expect(projectRoadEdges(g, region)).toHaveLength(1);
  });
});
