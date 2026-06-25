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

  it('super-samples the field S× (row stride = width·S, length = W·S·H·S)', () => {
    const g: RoadGraph = { nodes: [], edges: [roadEdge('e1', STRAIGHT)] };
    const f4 = buildRoadSurfaceField(mapWith(g), 4);
    expect(f4.length).toBe(24 * 4 * 24 * 4);
  });

  it('S>1 collapses to the per-cell field at integer tile centres', () => {
    // Fine cell (i,j) samples tile coord (i/S, j/S), so the sub-cells that land exactly
    // on a tile centre (i = tx·S, j = ty·S) must equal the S=1 value there — the super-
    // sampled field only ADDS detail between centres, never moves the integer samples.
    const g: RoadGraph = { nodes: [], edges: [roadEdge('e1', STRAIGHT, { surface: 'stone', class: 'highway' })] };
    const S = 4, w = 24;
    const base = buildRoadSurfaceField(mapWith(g), 1);
    const fine = buildRoadSurfaceField(mapWith(g), S);
    for (let ty = 10; ty <= 14; ty++) {
      for (let tx = 10; tx <= 18; tx++) {
        const b = base[ty * w + tx];
        const fIdx = (ty * S) * (w * S) + (tx * S);
        expect(fine[fIdx]).toBeCloseTo(b, 6);
      }
    }
  });

  it('liberates the edge: a sub-tile sample across the carriageway boundary lands between 0 and full', () => {
    // The point of super-sampling — the edge no longer snaps to a tile. Scan one row of
    // the fine lattice across the road and require at least one INTERMEDIATE (feathered)
    // sub-cell that a per-cell field could never represent at that position.
    const g: RoadGraph = { nodes: [], edges: [roadEdge('e1', STRAIGHT, { surface: 'stone', class: 'highway' })] };
    const S = 4, w = 24;
    const fine = buildRoadSurfaceField(mapWith(g), S);
    const row = 12 * S; // a fine row through the road centre (tile y=12)
    let sawFeather = false;
    for (let i = 0; i < w * S; i++) {
      const v = fine[row * (w * S) + i];
      if (v > 0.02 && v < 0.9) { sawFeather = true; break; }
    }
    expect(sawFeather).toBe(true);
  });
});
