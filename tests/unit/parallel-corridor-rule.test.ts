// tests/unit/parallel-corridor-rule.test.ts — the route-level parallel-road LINT rule
// (`road.parallel-corridor`): detects two DIFFERENT-endpoint roads whose polylines run
// near-parallel for a long stretch — the detection half of the merge-parallel-roads work (#26).
import { describe, it, expect } from 'vitest';
import { evaluateConnectome } from '@/world/connectome-diagnostics';
import type { GameMap } from '@/core/types';
import type { RoadEdge, RoadGraph } from '@/world/road-graph';

const line = (x0: number, y0: number, x1: number, y1: number, n = 12): { x: number; y: number }[] =>
  Array.from({ length: n + 1 }, (_, i) => ({ x: x0 + ((x1 - x0) * i) / n, y: y0 + ((y1 - y0) * i) / n }));

const edge = (id: string, a: string, b: string, poly: { x: number; y: number }[]): RoadEdge => ({
  id, a, b, polyline: poly, feature: 'road', class: 'road', surface: 'dirt', bridgeCells: [],
});

function ctxWith(edges: RoadEdge[]) {
  const graph: RoadGraph = { nodes: [], edges };
  return { world: {} as never, map: { roadGraph: graph } as unknown as GameMap };
}

const lint = (edges: RoadEdge[]) =>
  evaluateConnectome(ctxWith(edges)).diagnostics.filter((d) => d.rule === 'road.parallel-corridor');

describe('road.parallel-corridor', () => {
  it('flags two roads that run together (≈1 tile apart) for a long stretch', () => {
    const a = edge('e1', 'n1', 'n2', line(0, 10, 30, 10));
    const b = edge('e2', 'n3', 'n4', line(0, 11, 30, 11));   // parallel, 1 tile away
    const hits = lint([a, b]);
    expect(hits).toHaveLength(1);
    expect(hits[0].locus.edges).toEqual(['e1', 'e2']);
    expect(hits[0].suggestedFix?.verb).toBe('merge_roads');
    expect(hits[0].metrics?.sharedTiles).toBeGreaterThan(6);
  });

  it('does NOT flag two roads that merely cross', () => {
    const a = edge('e1', 'n1', 'n2', line(0, 10, 30, 10));
    const b = edge('e2', 'n3', 'n4', line(15, 0, 15, 30));   // perpendicular crossing
    expect(lint([a, b])).toHaveLength(0);
  });

  it('does NOT flag roads that are far apart', () => {
    const a = edge('e1', 'n1', 'n2', line(0, 10, 30, 10));
    const b = edge('e2', 'n3', 'n4', line(0, 40, 30, 40));   // 30 tiles away
    expect(lint([a, b])).toHaveLength(0);
  });

  it('does NOT flag a brief shared approach below the length/fraction floor', () => {
    // Two long roads that touch only near a shared junction, then diverge widely.
    const a = edge('e1', 'n1', 'n2', [...line(0, 10, 4, 10, 4), ...line(4, 10, 30, 0, 10)]);
    const b = edge('e2', 'n1', 'n3', [...line(0, 10, 4, 10, 4), ...line(4, 10, 30, 30, 10)]);
    expect(lint([a, b])).toHaveLength(0);
  });
});
