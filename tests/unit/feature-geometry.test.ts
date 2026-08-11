import { describe, it, expect, beforeEach } from 'vitest';
import type { GameMap } from '@/core/types';
import type { RoadGraph, RoadEdge } from '@/world/road-graph';
import {
  buildRoadFeatureGeometry, roadPavednessAt, clearRoadFeatureGeometryCache,
  binFeatureSegments, FEATURE_SEG_STRIDE, ROAD_EXTRA_WORDS, ROAD_EXTRA, type FeatureSeg,
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

// ── The ROAD STATE extension block ───────────────────────────────────────────────
//
// The buffer used to carry one surface scalar per end — `PAVEDNESS[material] ×
// condition × (1 − 0.7·overgrowth)` — which made three independent facts about a road
// indistinguishable downstream. These pin that the state now arrives SEPARATED, that
// the shader can find it, and that the along-road coordinate the sett courses are drawn
// in is continuous. See the ROAD_EXTRA_WORDS note in feature-geometry.ts.
describe('buildRoadFeatureGeometry — the road state extension block', () => {
  it('carries one ROAD_EXTRA row per segment, and the packed buffer has room for it', () => {
    const geo = buildRoadFeatureGeometry(mapWith({ nodes: [], edges: [highway()] } as unknown as RoadGraph));
    expect(geo.segCount).toBeGreaterThan(0);
    expect(geo.extras.length).toBe(geo.segCount * ROAD_EXTRA_WORDS);
    // The shader derives the extras base from segCount exactly this way; if the packing
    // ever stops appending them, this is what catches it.
    const nb = geo.nbx * geo.nby;
    const extBase = 4 + (nb + 1) + geo.bucketSegs.length + geo.segCount * FEATURE_SEG_STRIDE;
    expect(geo.packed.length).toBe(extBase + geo.segCount * ROAD_EXTRA_WORDS);
    const first = new Float32Array(geo.packed.buffer, extBase * 4, ROAD_EXTRA_WORDS);
    expect(first[ROAD_EXTRA.tier]).toBe(geo.extras[ROAD_EXTRA.tier]);
  });

  it('separates WHAT IT IS from WHAT SHAPE IT IS IN — the collapse this block exists to undo', () => {
    // A well-kept GRAVEL highway and a neglected COBBLED street collapse to the very same
    // pavedness scalar — the concrete case that made disrepair indistinguishable from
    // having been built cheaper.
    //
    // The COLLIDING CONDITION IS DERIVED, not decorative: coverage is
    // `PAVEDNESS[material] * (0.5 + 0.5*condition) * (1 - 0.5*overgrowth)`, so cobble 0.75
    // meets gravel-highway 0.45 at `0.5 + 0.5c = 0.6`, i.e. condition 0.2. It used to be
    // 0.6, back when condition multiplied in raw; the wearFade FLOOR (added so a ruined lane
    // does not thin out of existence before its disrepair can be seen) moved the meeting
    // point. If this assertion starts failing, re-solve it — do not loosen the tolerance,
    // because a near-miss is not the collapse this test is about.
    const kept = buildRoadFeatureGeometry(mapWith(
      { nodes: [], edges: [roadEdge('g', STRAIGHT, { surface: 'dirt', class: 'highway' })] } as unknown as RoadGraph));
    const ruined = buildRoadFeatureGeometry(mapWith(
      { nodes: [], edges: [roadEdge('s', STRAIGHT, { surface: 'stone', class: 'road',
        dynamics: { condition: 0.2 } })] } as unknown as RoadGraph, 99));
    const pavedOf = (g: typeof kept) => g.segments[6];
    expect(pavedOf(kept)).toBeCloseTo(pavedOf(ruined), 2);          // indistinguishable…
    expect(kept.extras[ROAD_EXTRA.tier]).not.toBe(ruined.extras[ROAD_EXTRA.tier]);   // …but not any more
    expect(ruined.extras[ROAD_EXTRA.condition]).toBeCloseTo(0.2, 5);
    expect(kept.extras[ROAD_EXTRA.condition]).toBeCloseTo(1, 5);
  });

  it('arc length is cumulative along the edge — the courses must not restart at each vertex', () => {
    // A CURVE, not STRAIGHT: `edgeRoadProfile` simplifies a straight run to a single
    // segment, which would pass a monotonicity check vacuously.
    const bend = Array.from({ length: 20 }, (_, i) => ({ x: 4 + i, y: 6 + Math.round(4 * Math.sin(i / 3)) }));
    const geo = buildRoadFeatureGeometry(mapWith(
      { nodes: [], edges: [roadEdge('c', bend, { surface: 'stone', class: 'highway' })] } as unknown as RoadGraph));
    expect(geo.segCount).toBeGreaterThan(2);
    let prev = -1;
    for (let i = 0; i < geo.segCount; i++) {
      const arc = geo.extras[i * ROAD_EXTRA_WORDS + ROAD_EXTRA.arc0];
      expect(arc).toBeGreaterThan(prev);
      prev = arc;
    }
    // …and it measures the real length, not the segment index.
    const total = geo.extras[(geo.segCount - 1) * ROAD_EXTRA_WORDS + ROAD_EXTRA.arc0];
    expect(total).toBeGreaterThan(1);
  });

  it('gives each edge its own pattern phase so two roads never wear in step', () => {
    const geo = buildRoadFeatureGeometry(mapWith({
      nodes: [],
      edges: [highway('e1'), roadEdge('e2', Array.from({ length: 12 }, (_, i) => ({ x: 4, y: 4 + i })),
        { surface: 'stone', class: 'highway' })],
    } as unknown as RoadGraph));
    const seeds = new Set<number>();
    for (let i = 0; i < geo.segCount; i++) seeds.add(geo.extras[i * ROAD_EXTRA_WORDS + ROAD_EXTRA.edgeSeed]);
    expect(seeds.size).toBe(2);
  });
});
