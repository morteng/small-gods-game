// tests/unit/merge-parallel-roads.test.ts — the connectivity-preserving merge for #26.
// The safety invariant: a redundant parallel road is dropped ONLY when its endpoints stay
// connected without it, so the network NEVER splits.
import { describe, it, expect } from 'vitest';
import { mergeParallelRoads } from '@/world/connectome/merge-parallel-roads';
import type { RoadEdge, RoadGraph, RoadClass } from '@/world/road-graph';

const line = (x0: number, y0: number, x1: number, y1: number, n = 12) =>
  Array.from({ length: n + 1 }, (_, i) => ({ x: x0 + ((x1 - x0) * i) / n, y: y0 + ((y1 - y0) * i) / n }));
const edge = (id: string, a: string, b: string, poly: { x: number; y: number }[], cls: RoadClass = 'road'): RoadEdge =>
  ({ id, a, b, polyline: poly, feature: 'road', class: cls, surface: 'dirt', bridgeCells: [] });
const graph = (edges: RoadEdge[]): RoadGraph => ({ nodes: [], edges });

describe('mergeParallelRoads', () => {
  it('drops a redundant parallel road WHEN its endpoints stay connected (non-bridge)', () => {
    // A(n1-n2) ∥ B(n3-n4); connectors C(n1-n3) + D(n2-n4) keep n3↔n4 reachable without B.
    const r = mergeParallelRoads(graph([
      edge('A', 'n1', 'n2', line(0, 10, 30, 10)),
      edge('B', 'n3', 'n4', line(0, 11, 30, 11)),
      edge('C', 'n1', 'n3', line(0, 10, 0, 11, 1)),
      edge('D', 'n2', 'n4', line(30, 10, 30, 11, 1)),
    ]));
    expect(r.removed).toEqual(['A']);                       // one of the equal pair dropped (e1)
    expect(r.graph.edges.map((e) => e.id).sort()).toEqual(['B', 'C', 'D']);
  });

  it('KEEPS a parallel road when it is the ONLY link between its endpoints (a bridge)', () => {
    // No connectors → dropping B would strand n3/n4. Connectivity guard refuses.
    const r = mergeParallelRoads(graph([
      edge('A', 'n1', 'n2', line(0, 10, 30, 10)),
      edge('B', 'n3', 'n4', line(0, 11, 30, 11)),
    ]));
    expect(r.removed).toEqual([]);
    expect(r.graph.edges).toHaveLength(2);
  });

  it('drops the LOWER-class road of a pair, keeping the more important one', () => {
    const r = mergeParallelRoads(graph([
      edge('hwy', 'n1', 'n2', line(0, 10, 30, 10), 'highway'),
      edge('path', 'n3', 'n4', line(0, 11, 30, 11), 'path'),
      edge('c1', 'n1', 'n3', line(0, 10, 0, 11, 1)),
      edge('c2', 'n2', 'n4', line(30, 10, 30, 11, 1)),
    ]));
    expect(r.removed).toEqual(['path']);                    // never the highway
  });

  it('leaves non-parallel roads (a crossing) untouched', () => {
    const r = mergeParallelRoads(graph([
      edge('A', 'n1', 'n2', line(0, 10, 30, 10)),
      edge('B', 'n3', 'n4', line(15, 0, 15, 30)),           // perpendicular
    ]));
    expect(r.removed).toEqual([]);
  });

  it('is a no-op (same graph object) when nothing merges', () => {
    const g = graph([edge('A', 'n1', 'n2', line(0, 10, 30, 10))]);
    expect(mergeParallelRoads(g).graph).toBe(g);
  });
});
