import { describe, it, expect, beforeEach } from 'vitest';
import type { GameMap } from '@/core/types';
import type { RoadGraph, RoadEdge } from '@/world/road-graph';
import {
  buildRoadFeatureGeometry, roadPavednessAt, clearRoadFeatureGeometryCache,
  binFeatureSegments, FEATURE_SEG_STRIDE, type FeatureSeg,
} from '@/render/gpu/feature-geometry';

function mapWith(roadGraph?: RoadGraph, seed = 1234, width = 24, height = 24): GameMap {
  return { seed, width, height, roadGraph } as unknown as GameMap;
}

function roadEdge(id: string, polyline: { x: number; y: number }[], partial: Partial<RoadEdge> = {}): RoadEdge {
  return { id, a: `${id}-a`, b: `${id}-b`, polyline, feature: 'road', class: 'road', surface: 'dirt', bridgeCells: [], ...partial };
}

const STRAIGHT = Array.from({ length: 16 }, (_, i) => ({ x: 6 + i, y: 12 }));
const highway = (id = 'e1') => roadEdge(id, STRAIGHT, { surface: 'stone', class: 'highway' });

beforeEach(() => clearRoadFeatureGeometryCache());

describe('binFeatureSegments — shared bucket substrate', () => {
  it('CSR offsets are monotonic and end at the flattened ref count', () => {
    const segs: FeatureSeg[] = [
      { ax: 1, ay: 1, bx: 5, by: 1, halfA: 1, halfB: 1, surfA: 1, surfB: 1, reach: 2 },
      { ax: 5, ay: 1, bx: 9, by: 4, halfA: 1, halfB: 1, surfA: 1, surfB: 1, reach: 2 },
    ];
    const b = binFeatureSegments(segs, 24, 24);
    expect(b.segCount).toBe(2);
    expect(b.segments.length).toBe(2 * FEATURE_SEG_STRIDE);
    expect(b.bucketOffset.length).toBe(b.nbx * b.nby + 1);
    for (let i = 0; i + 1 < b.bucketOffset.length; i++) {
      expect(b.bucketOffset[i + 1]).toBeGreaterThanOrEqual(b.bucketOffset[i]);
    }
    expect(b.bucketOffset[b.bucketOffset.length - 1]).toBe(b.bucketSegs.length);
  });
});

describe('buildRoadFeatureGeometry — analytic road pavedness', () => {
  it('emits no segments when there is no road graph; pavedness is 0 everywhere', () => {
    const geo = buildRoadFeatureGeometry(mapWith());
    expect(geo.segCount).toBe(0);
    expect(roadPavednessAt(geo, 12, 12)).toBe(0);
    // header-only buffer: [bucketTiles, nbx, nby, segCount=0]
    expect(geo.packed[3]).toBe(0);
  });

  it('packs a self-describing header (bucketTiles, nbx, nby, segCount)', () => {
    const geo = buildRoadFeatureGeometry(mapWith({ nodes: [], edges: [highway()] }));
    expect(geo.packed[0]).toBe(geo.bucketTiles);
    expect(geo.packed[1]).toBe(geo.nbx);
    expect(geo.packed[2]).toBe(geo.nby);
    expect(geo.packed[3]).toBe(geo.segCount);
    expect(geo.segCount).toBeGreaterThan(0);
  });

  it('paves the carriageway and leaves distant ground bare', () => {
    const geo = buildRoadFeatureGeometry(mapWith({ nodes: [], edges: [highway()] }));
    expect(roadPavednessAt(geo, 13, 12)).toBeGreaterThan(0.5);  // on the road
    expect(roadPavednessAt(geo, 13, 20)).toBe(0);               // far off
  });

  it('paves a stone highway harder than a dirt footpath', () => {
    const hw = buildRoadFeatureGeometry(mapWith({ nodes: [], edges: [highway('e')] }));
    clearRoadFeatureGeometryCache();
    const path = buildRoadFeatureGeometry(mapWith({ nodes: [], edges: [roadEdge('e', STRAIGHT, { surface: 'dirt', class: 'path' })] }));
    expect(roadPavednessAt(hw, 13, 12)).toBeGreaterThan(roadPavednessAt(path, 13, 12));
  });

  it('is deterministic — same world ⇒ identical packed buffer', () => {
    const g: RoadGraph = { nodes: [], edges: [highway()] };
    const a = buildRoadFeatureGeometry(mapWith(g));
    const b = buildRoadFeatureGeometry(mapWith(g));
    expect(Array.from(a.packed)).toEqual(Array.from(b.packed));
  });

  it('liberates the edge from the grid: pavedness is a CONTINUOUS sub-tile feather', () => {
    // The whole point — the carriageway boundary is no longer quantised to a 2 m cell.
    // Sample a fine sweep across the road at y=12 and require an intermediate (feathered)
    // value at a fractional position a per-cell field could never represent there.
    const geo = buildRoadFeatureGeometry(mapWith({ nodes: [], edges: [highway()] }));
    let sawFeather = false;
    // Sweep ACROSS the carriageway (perpendicular to a road that runs along y=12).
    for (let y = 12; y <= 15 && !sawFeather; y += 0.05) {
      const v = roadPavednessAt(geo, 13, y);
      if (v > 0.02 && v < 0.9) sawFeather = true;
    }
    expect(sawFeather).toBe(true);
  });

  it('pavedness falls off monotonically moving off the centreline', () => {
    const geo = buildRoadFeatureGeometry(mapWith({ nodes: [], edges: [highway()] }));
    const center = roadPavednessAt(geo, 13, 12);
    const mid = roadPavednessAt(geo, 13, 12.9);
    const off = roadPavednessAt(geo, 13, 14);
    expect(center).toBeGreaterThanOrEqual(mid);
    expect(mid).toBeGreaterThanOrEqual(off);
    expect(off).toBe(0);
  });
});
