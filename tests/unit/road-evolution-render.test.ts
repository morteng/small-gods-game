import { describe, it, expect, beforeEach } from 'vitest';
import type { GameMap } from '@/core/types';
import type { RoadGraph, RoadEdge } from '@/world/road-graph';
import { getRoadSurfaceField, clearRoadSurfaceCache } from '@/world/road-surface';
import { evolveRoadGraph } from '@/world/road-evolution';

// End-to-end: prove that evolving the graph actually changes the RENDERED surface field
// through the rev-keyed cache. This is the data-path check a screenshot would do visually —
// an overgrown road must read as LESS paved (it greens back toward biome).
function mapWith(roadGraph?: RoadGraph): GameMap {
  return { seed: 1234, width: 24, height: 24, roadGraph } as unknown as GameMap;
}

function roadEdge(id: string, partial: Partial<RoadEdge> = {}): RoadEdge {
  return {
    id, a: `${id}-a`, b: `${id}-b`,
    polyline: Array.from({ length: 16 }, (_, i) => ({ x: 6 + i, y: 12 })),
    feature: 'road', class: 'road', surface: 'stone', bridgeCells: [],
    ...partial,
  };
}

const at = (f: Float32Array, x: number, y: number) => f[y * 24 + x];

beforeEach(() => clearRoadSurfaceCache());

describe('road evolution → rendered surface field (data path)', () => {
  it('a neglected road reads as less paved after decades, via the rev-keyed cache', () => {
    const graph: RoadGraph = { nodes: [], edges: [roadEdge('e1', { class: 'path', surface: 'dirt' })] };
    const map = mapWith(graph);

    const fresh = at(getRoadSurfaceField(map), 13, 12);
    expect(fresh).toBeGreaterThan(0.1);

    // Evolve 60 years with no upkeep: condition collapses, overgrowth rises → pavedness drops.
    evolveRoadGraph(graph, 60, { upkeepFor: () => 0, trafficFor: () => 0.15 });
    expect(graph.rev).toBe(1); // cache key moved

    const aged = at(getRoadSurfaceField(map), 13, 12);
    expect(aged).toBeLessThan(fresh); // greening over — the cleanup lets biome show through
  });

  it('the rev bump is what invalidates the cache (same rev ⇒ same field instance)', () => {
    const graph: RoadGraph = { nodes: [], edges: [roadEdge('e1')] };
    const map = mapWith(graph);
    const a = getRoadSurfaceField(map);
    const b = getRoadSurfaceField(map);
    expect(b).toBe(a); // memoised while rev unchanged

    evolveRoadGraph(graph, 10);
    const c = getRoadSurfaceField(map);
    expect(c).not.toBe(a); // rev bumped → fresh field
  });

  it('a maintained highway barely changes its pavedness over the same span', () => {
    const graph: RoadGraph = { nodes: [], edges: [roadEdge('hw', { class: 'highway', surface: 'stone' })] };
    const map = mapWith(graph);
    const fresh = at(getRoadSurfaceField(map), 13, 12);

    evolveRoadGraph(graph, 60); // class default upkeep 0.9 keeps it pristine
    const kept = at(getRoadSurfaceField(map), 13, 12);
    expect(Math.abs(kept - fresh)).toBeLessThan(0.1);
  });
});
