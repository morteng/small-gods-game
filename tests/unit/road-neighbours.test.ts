import { describe, it, expect } from 'vitest';
import type { GameMap } from '@/core/types';
import type { RoadEdge, RoadGraph, RoadNode } from '@/world/road-graph';
import { roadNeighbours } from '@/world/road-neighbours';

// Minimal fakes — roadNeighbours reads only map.roadGraph (mirrors the
// connectome-diagnostics/-contracts stubbing idiom: cast a bare object as GameMap).

function poiNode(id: string, poiRef: string, x: number, y: number): RoadNode {
  return { id, x, y, kind: 'poi', poiRef };
}

function wpNode(id: string, x: number, y: number, kind: RoadNode['kind'] = 'waypoint'): RoadNode {
  return { id, x, y, kind };
}

function road(id: string, a: string, b: string, polyline: { x: number; y: number }[] = []): RoadEdge {
  return {
    id,
    a,
    b,
    polyline,
    feature: 'road',
    class: 'road',
    surface: 'dirt',
    bridgeCells: [],
  };
}

function mapWith(graph?: RoadGraph): GameMap {
  return { roadGraph: graph } as unknown as GameMap;
}

describe('roadNeighbours', () => {
  it('direct edge: each POI is the other\'s neighbour at hops=1, distTiles = edge length', () => {
    const nodes = [poiNode('nA', 'a', 0, 0), poiNode('nB', 'b', 3, 4)];
    const edges = [road('e1', 'nA', 'nB')];
    const map = mapWith({ nodes, edges });

    expect(roadNeighbours(map, 'a', 5)).toEqual([{ poiId: 'b', hops: 1, distTiles: 5 }]);
    expect(roadNeighbours(map, 'b', 5)).toEqual([{ poiId: 'a', hops: 1, distTiles: 5 }]);
  });

  it('poi—waypoint—poi: waypoint is pass-through, still hops=1, distTiles sums both segments', () => {
    const nodes = [poiNode('nA', 'a', 0, 0), wpNode('nW', 3, 0), poiNode('nB', 'b', 3, 4)];
    const edges = [road('e1', 'nA', 'nW'), road('e2', 'nW', 'nB')];
    const map = mapWith({ nodes, edges });

    expect(roadNeighbours(map, 'a', 5)).toEqual([{ poiId: 'b', hops: 1, distTiles: 3 + 4 }]);
  });

  it('chain A—B—C: maxHops=1 finds only B; maxHops=2 finds B and C with summed distance', () => {
    const nodes = [poiNode('nA', 'a', 0, 0), poiNode('nB', 'b', 3, 0), poiNode('nC', 'c', 3, 4)];
    const edges = [road('e1', 'nA', 'nB'), road('e2', 'nB', 'nC')];
    const map = mapWith({ nodes, edges });

    expect(roadNeighbours(map, 'a', 1)).toEqual([{ poiId: 'b', hops: 1, distTiles: 3 }]);
    expect(roadNeighbours(map, 'a', 2)).toEqual([
      { poiId: 'b', hops: 1, distTiles: 3 },
      { poiId: 'c', hops: 2, distTiles: 3 + 4 },
    ]);
  });

  it('maxHops=0, no roadGraph, or unknown poiId all return []', () => {
    const nodes = [poiNode('nA', 'a', 0, 0), poiNode('nB', 'b', 3, 4)];
    const edges = [road('e1', 'nA', 'nB')];
    const map = mapWith({ nodes, edges });

    expect(roadNeighbours(map, 'a', 0)).toEqual([]);
    expect(roadNeighbours(mapWith(undefined), 'a', 5)).toEqual([]);
    expect(roadNeighbours(map, 'ghost', 5)).toEqual([]);
  });

  it('is deterministic and sorted by (hops, distTiles, poiId)', () => {
    // A hub with three one-hop spokes at deliberately unsorted distances/ids so a
    // correct implementation must sort, not just emit in discovery order.
    const nodes = [
      poiNode('nHub', 'hub', 0, 0),
      poiNode('nZ', 'z', 1, 0), // dist 1
      poiNode('nY', 'y', 5, 0), // dist 5
      poiNode('nA', 'a', 5, 0), // dist 5, ties with y on distance — poiId breaks the tie
    ];
    const edges = [
      road('e1', 'nHub', 'nZ'),
      road('e2', 'nHub', 'nY'),
      road('e3', 'nHub', 'nA'),
    ];
    const map = mapWith({ nodes, edges });

    const first = roadNeighbours(map, 'hub', 3);
    const second = roadNeighbours(map, 'hub', 3);
    expect(first).toEqual(second);
    expect(first).toEqual([
      { poiId: 'z', hops: 1, distTiles: 1 },
      { poiId: 'a', hops: 1, distTiles: 5 },
      { poiId: 'y', hops: 1, distTiles: 5 },
    ]);
  });

  it('excludes the queried POI itself even when a cycle routes back through it', () => {
    const nodes = [poiNode('nA', 'a', 0, 0), poiNode('nB', 'b', 3, 0), poiNode('nC', 'c', 3, 4)];
    // Triangle: a-b, b-c, c-a. From 'a' within budget, 'a' must never appear.
    const edges = [road('e1', 'nA', 'nB'), road('e2', 'nB', 'nC'), road('e3', 'nC', 'nA')];
    const map = mapWith({ nodes, edges });

    const result = roadNeighbours(map, 'a', 5);
    expect(result.some((n) => n.poiId === 'a')).toBe(false);
    expect(result.map((n) => n.poiId).sort()).toEqual(['b', 'c']);
  });

  it('non-road edges (e.g. rivers sharing the graph) are not traversed as road links', () => {
    const nodes = [poiNode('nA', 'a', 0, 0), poiNode('nB', 'b', 3, 4)];
    const riverEdge: RoadEdge = { ...road('e1', 'nA', 'nB'), feature: 'river' };
    const map = mapWith({ nodes, edges: [riverEdge] });

    expect(roadNeighbours(map, 'a', 5)).toEqual([]);
  });
});
