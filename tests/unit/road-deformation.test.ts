import { describe, it, expect, beforeEach } from 'vitest';
import type { GameMap } from '@/core/types';
import type { RoadGraph, RoadEdge } from '@/world/road-graph';
import {
  buildRoadDeformations,
  getRoadDeformationStore,
  getComposedHeightfield,
  clearRoadDeformationCache,
} from '@/world/road-deformation';
import {
  getHeightfield,
  clearHeightfieldCache,
  heightMetresAt as baseHeightAt,
  ELEVATION_SEA_LEVEL,
  TERRAIN_RELIEF_M,
} from '@/world/heightfield';
import { heightAt, baseHeightAt as baseM, DeformationStore } from '@/world/terrain-deformation';

// A minimal GameMap — road-deformation reads only seed/width/height/roadGraph.
function mapWith(roadGraph?: RoadGraph, seed = 1234, width = 24, height = 24): GameMap {
  return { seed, width, height, roadGraph } as unknown as GameMap;
}

function roadEdge(id: string, polyline: { x: number; y: number }[], partial: Partial<RoadEdge> = {}): RoadEdge {
  return {
    id,
    a: `${id}-a`,
    b: `${id}-b`,
    polyline,
    feature: 'road',
    class: 'road',
    surface: 'dirt',
    bridgeCells: [],
    ...partial,
  };
}

beforeEach(() => {
  clearRoadDeformationCache();
  clearHeightfieldCache();
});

describe('buildRoadDeformations', () => {
  it('emits one level brush per unit segment, targeting the segment mean grade', () => {
    const map = mapWith();
    const pts = [{ x: 4, y: 4 }, { x: 5, y: 4 }, { x: 6, y: 4 }];
    const graph: RoadGraph = { nodes: [], edges: [roadEdge('e1', pts)] };
    const defs = buildRoadDeformations(map, graph);

    expect(defs).toHaveLength(2); // 3 points → 2 segments
    expect(defs.map(d => d.id)).toEqual(['e1:0', 'e1:1']);
    for (const d of defs) {
      expect(d.op).toBe('level');
      expect(d.source).toBe('road:cut');
    }
    // First segment levels toward the mean base height of its endpoints (metres).
    const expected = (baseHeightAt(map, 4, 4) + baseHeightAt(map, 5, 4)) / 2;
    expect(defs[0].target).toBeCloseTo(expected, 6);
  });

  it('ignores rivers and walls (roads only)', () => {
    const map = mapWith();
    const graph: RoadGraph = {
      nodes: [],
      edges: [
        roadEdge('r', [{ x: 1, y: 1 }, { x: 2, y: 1 }], { feature: 'river' }),
        roadEdge('w', [{ x: 1, y: 3 }, { x: 2, y: 3 }], { feature: 'wall' }),
        roadEdge('road', [{ x: 1, y: 5 }, { x: 2, y: 5 }]),
      ],
    };
    const defs = buildRoadDeformations(map, graph);
    expect(defs).toHaveLength(1);
    expect(defs[0].id).toBe('road:0');
  });

  it('skips degenerate edges (fewer than 2 points)', () => {
    const map = mapWith();
    const graph: RoadGraph = { nodes: [], edges: [roadEdge('e', [{ x: 3, y: 3 }])] };
    expect(buildRoadDeformations(map, graph)).toHaveLength(0);
  });

  it('carves a path WEAKER than a highway over the same route (tier→carve strength)', () => {
    const pts = [{ x: 2, y: 12 }, { x: 21, y: 12 }];
    const pathMap = mapWith({ nodes: [], edges: [roadEdge('e', pts, { class: 'path' })] });
    const hwMap = mapWith({ nodes: [], edges: [roadEdge('e', pts, { class: 'highway' })] });

    // Build stores directly — getRoadDeformationStore memoises by (seed,dims), which
    // collide here, so go through buildRoadDeformations into fresh stores.
    const pathStore = new DeformationStore();
    pathStore.add(...buildRoadDeformations(pathMap, pathMap.roadGraph!));
    const hwStore = new DeformationStore();
    hwStore.add(...buildRoadDeformations(hwMap, hwMap.roadGraph!));

    // Sum |displacement| along the centreline: the highway pulls to grade harder.
    let pathMove = 0, hwMove = 0;
    const y = 12;
    for (let x = 3; x < 21; x++) {
      pathMove += Math.abs(heightAt(pathMap, pathStore, x, y) - baseM(pathMap, x, y));
      hwMove += Math.abs(heightAt(hwMap, hwStore, x, y) - baseM(hwMap, x, y));
    }
    expect(hwMove).toBeGreaterThan(pathMove); // highway carves a flatter shelf
    // The path still does *something* (it is not a no-op).
    expect(pathMove).toBeGreaterThan(0);
  });
});

describe('getComposedHeightfield — parity', () => {
  it('returns the BASE array instance when the map has no road graph', () => {
    const map = mapWith(undefined);
    const base = getHeightfield(map.seed, map.width, map.height);
    expect(getComposedHeightfield(map)).toBe(base);
  });

  it('returns the base instance when the road graph has no road edges', () => {
    const graph: RoadGraph = { nodes: [], edges: [roadEdge('r', [{ x: 1, y: 1 }, { x: 2, y: 1 }], { feature: 'river' })] };
    const map = mapWith(graph);
    const base = getHeightfield(map.seed, map.width, map.height);
    expect(getComposedHeightfield(map)).toBe(base);
  });
});

describe('getComposedHeightfield — grade-cut', () => {
  // A long straight road across the map guarantees it crosses sloped terrain.
  function roadAcross(map: GameMap): RoadGraph {
    const pts: { x: number; y: number }[] = [];
    const y = Math.floor(map.height / 2);
    for (let x = 2; x < map.width - 2; x++) pts.push({ x, y });
    return { nodes: [], edges: [roadEdge('main', pts)] };
  }

  it('lowers/raises the road corridor toward grade while leaving distant terrain at base', () => {
    const graph = roadAcross(mapWith());
    const map = mapWith(graph);
    const base = getHeightfield(map.seed, map.width, map.height);
    const composed = getComposedHeightfield(map);

    expect(composed).not.toBe(base); // a real cut was applied
    const y = Math.floor(map.height / 2);

    // At least one corridor cell actually moved.
    let moved = 0;
    for (let x = 3; x < map.width - 3; x++) {
      if (Math.abs(composed[y * map.width + x] - base[y * map.width + x]) > 1e-6) moved++;
    }
    expect(moved).toBeGreaterThan(0);

    // A row far from the road is untouched (beyond corridor + feather).
    const farY = 0;
    for (let x = 0; x < map.width; x++) {
      expect(composed[farY * map.width + x]).toBeCloseTo(base[farY * map.width + x], 6);
    }
  });

  it('composed field equals the channel heightAt converted to normalised units', () => {
    const graph = roadAcross(mapWith());
    const map = mapWith(graph);
    const composed = getComposedHeightfield(map);
    const store = getRoadDeformationStore(map);
    const y = Math.floor(map.height / 2);
    const x = Math.floor(map.width / 2);
    const m = heightAt(map, store, x, y);
    expect(composed[y * map.width + x]).toBeCloseTo(m / TERRAIN_RELIEF_M + ELEVATION_SEA_LEVEL, 6);
    // Sanity: the channel's base read matches heightfield metres.
    expect(baseM(map, x, y)).toBeCloseTo((getHeightfield(map.seed, map.width, map.height)[y * map.width + x] - ELEVATION_SEA_LEVEL) * TERRAIN_RELIEF_M, 6);
  });

  it('is deterministic and memoised (same instance across calls)', () => {
    const map = mapWith(roadAcross(mapWith()));
    const a = getComposedHeightfield(map);
    const b = getComposedHeightfield(map);
    expect(a).toBe(b);

    clearRoadDeformationCache();
    const c = getComposedHeightfield(map);
    expect(c).not.toBe(a); // fresh array after cache clear
    expect(Array.from(c)).toEqual(Array.from(a)); // identical values
  });
});
