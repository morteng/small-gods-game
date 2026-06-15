import { describe, it, expect } from 'vitest';
import { buildRoadRibbonItems } from '@/render/iso/iso-road-ribbon';
import type { RoadGraph, RoadEdge } from '@/world/road-graph';

const ORIGIN = { originX: 100, originY: 50 };

function edge(id: string, polyline: { x: number; y: number }[], p: Partial<RoadEdge> = {}): RoadEdge {
  return {
    id, a: `${id}a`, b: `${id}b`, polyline,
    feature: 'road', class: 'road', surface: 'dirt', bridgeCells: [], ...p,
  };
}
function graph(...edges: RoadEdge[]): RoadGraph {
  return { nodes: [], edges };
}

describe('buildRoadRibbonItems', () => {
  it('returns nothing for an empty/undefined graph', () => {
    expect(buildRoadRibbonItems(undefined, ORIGIN)).toEqual([]);
    expect(buildRoadRibbonItems(graph(), ORIGIN)).toEqual([]);
  });

  it('emits quad polys for a straight road, each with 4 points and the surface color', () => {
    const pts = [{ x: 2, y: 4 }, { x: 3, y: 4 }, { x: 4, y: 4 }, { x: 5, y: 4 }];
    const items = buildRoadRibbonItems(graph(edge('r', pts)), ORIGIN);
    expect(items.length).toBeGreaterThan(0);
    for (const it of items) {
      expect(it.t).toBe('poly');
      if (it.t === 'poly') {
        expect(it.points).toHaveLength(4);
        expect(it.color).toBe('#5f4d33'); // dirt
      }
    }
  });

  it('colors stone roads differently', () => {
    const pts = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }];
    const items = buildRoadRibbonItems(graph(edge('s', pts, { surface: 'stone' })), ORIGIN);
    expect(items.every(it => it.t === 'poly' && it.color === '#857c70')).toBe(true);
  });

  it('skips rivers, walls, and degenerate edges', () => {
    const g = graph(
      edge('riv', [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 }], { feature: 'river' }),
      edge('wal', [{ x: 1, y: 3 }, { x: 2, y: 3 }, { x: 3, y: 3 }], { feature: 'wall' }),
      edge('one', [{ x: 5, y: 5 }], {}),
      edge('rd', [{ x: 1, y: 7 }, { x: 2, y: 7 }, { x: 3, y: 7 }], {}),
    );
    const items = buildRoadRibbonItems(g, ORIGIN);
    // Only the 'rd' road contributes.
    expect(items.length).toBeGreaterThan(0);
    const onlyRoad = buildRoadRibbonItems(graph(edge('rd', [{ x: 1, y: 7 }, { x: 2, y: 7 }, { x: 3, y: 7 }])), ORIGIN);
    expect(items).toEqual(onlyRoad);
  });

  it('is deterministic and smooths a bend into multiple quads', () => {
    const lshape = [{ x: 2, y: 2 }, { x: 3, y: 2 }, { x: 3, y: 3 }, { x: 3, y: 4 }];
    const a = buildRoadRibbonItems(graph(edge('L', lshape)), ORIGIN);
    const b = buildRoadRibbonItems(graph(edge('L', lshape)), ORIGIN);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThanOrEqual(lshape.length - 1); // resampled, not fewer than raw segments
  });
});
