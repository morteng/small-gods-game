import { describe, it, expect, beforeEach } from 'vitest';
import type { GameMap } from '@/core/types';
import type { RoadGraph, RoadEdge } from '@/world/road-graph';
import { buildRoadSurfaceField, clearRoadSurfaceCache } from '@/world/road-surface';

function mapWith(roadGraph?: RoadGraph, seed = 1234, width = 24, height = 24): GameMap {
  return { seed, width, height, roadGraph } as unknown as GameMap;
}

function roadEdge(id: string, polyline: { x: number; y: number }[], partial: Partial<RoadEdge> = {}): RoadEdge {
  return { id, a: `${id}-a`, b: `${id}-b`, polyline, feature: 'road', class: 'road', surface: 'dirt', bridgeCells: [], ...partial };
}

const STRAIGHT = Array.from({ length: 16 }, (_, i) => ({ x: 6 + i, y: 12 }));
const at = (f: Float32Array, w: number, x: number, y: number) => f[y * w + x];

beforeEach(() => clearRoadSurfaceCache());

describe('buildRoadSurfaceField', () => {
  it('is all zero when there is no road graph', () => {
    const f = buildRoadSurfaceField(mapWith());
    expect(f.every((v) => v === 0)).toBe(true);
  });

  it('marks the carriageway and leaves distant cells bare', () => {
    const f = buildRoadSurfaceField(mapWith({ nodes: [], edges: [roadEdge('e1', STRAIGHT, { surface: 'stone', class: 'highway' })] }));
    expect(at(f, 24, 13, 12)).toBeGreaterThan(0.5); // on the road
    expect(at(f, 24, 13, 20)).toBe(0); // far off
  });

  it('paves a stone highway harder than a dirt footpath', () => {
    const cobble = buildRoadSurfaceField(mapWith({ nodes: [], edges: [roadEdge('e', STRAIGHT, { surface: 'stone', class: 'highway' })] }));
    clearRoadSurfaceCache();
    const dirt = buildRoadSurfaceField(mapWith({ nodes: [], edges: [roadEdge('e', STRAIGHT, { surface: 'dirt', class: 'path' })] }));
    expect(at(cobble, 24, 13, 12)).toBeGreaterThan(at(dirt, 24, 13, 12));
  });

  it('is deterministic', () => {
    const g: RoadGraph = { nodes: [], edges: [roadEdge('e1', STRAIGHT)] };
    expect(Array.from(buildRoadSurfaceField(mapWith(g)))).toEqual(Array.from(buildRoadSurfaceField(mapWith(g))));
  });
});
