// tests/unit/fate-world-quality.test.ts — Fate consumption of the connectome LINTER:
// describeWorldQualityForFate digests evaluateConnectome into the Fate prompt, so the DM
// notices world-quality issues (and can act via each diagnostic's suggestedFix verb). Empty
// when the world lints clean, so a healthy world adds nothing to the prompt.
import { describe, it, expect } from 'vitest';
import { describeWorldQualityForFate } from '@/game/fate/fate-context';
import { World } from '@/world/world';
import type { GameState } from '@/core/state';
import type { GameMap } from '@/core/types';
import type { RoadEdge, RoadGraph } from '@/world/road-graph';

const line = (x0: number, y0: number, x1: number, y1: number, n = 12) =>
  Array.from({ length: n + 1 }, (_, i) => ({ x: x0 + ((x1 - x0) * i) / n, y: y0 + ((y1 - y0) * i) / n }));
const edge = (id: string, poly: { x: number; y: number }[]): RoadEdge =>
  ({ id, a: `${id}A`, b: `${id}B`, polyline: poly, feature: 'road', class: 'road', surface: 'dirt', bridgeCells: [] });

function stateWith(edges: RoadEdge[]): GameState {
  const graph: RoadGraph = { nodes: [], edges };
  const map = { width: 64, height: 64, roadGraph: graph, tiles: [] } as unknown as GameMap;
  return { world: new World(map), map } as GameState;
}

describe('describeWorldQualityForFate', () => {
  it('is empty for a clean world (adds nothing to the prompt)', () => {
    expect(describeWorldQualityForFate(stateWith([]))).toBe('');
  });

  it('is empty when world/map are absent (guarded)', () => {
    expect(describeWorldQualityForFate({ world: null, map: null } as unknown as GameState)).toBe('');
  });

  it('digests the lint report when the connectome has issues', () => {
    const text = describeWorldQualityForFate(stateWith([
      edge('e1', line(0, 10, 30, 10)),
      edge('e2', line(0, 11, 30, 11)),   // parallel corridor → road.parallel-corridor
    ]));
    expect(text).toContain('World quality');
    expect(text).toContain('road.parallel-corridor');
    expect(text).toContain('warn');
  });
});
