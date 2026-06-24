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
} from '@/world/heightfield';
import { heightAt } from '@/world/terrain-deformation';

// A minimal GameMap — road-deformation reads seed/width/height/roadGraph/worldSeed.
// 24×24 seed 1234 is riverless, so the WORLD store (roads ⊕ rivers) is empty without
// a road graph — the parity case. (A larger map grows rivers that compose too.)
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

// A straight east–west road across the middle of the map.
const STRAIGHT = Array.from({ length: 16 }, (_, i) => ({ x: 6 + i, y: 16 }));

beforeEach(() => {
  clearRoadDeformationCache();
  clearHeightfieldCache();
});

describe('buildRoadDeformations — one corridor per road edge', () => {
  it('emits exactly one level corridor deformation per road edge', () => {
    const graph: RoadGraph = { nodes: [], edges: [roadEdge('e1', STRAIGHT)] };
    const defs = buildRoadDeformations(mapWith(), graph);
    expect(defs).toHaveLength(1);
    expect(defs[0].id).toBe('e1:corridor');
    expect(defs[0].op).toBe('level');
    expect(defs[0].source).toBe('road:cut');
    expect(typeof defs[0].targetAt).toBe('function'); // per-tile cross-section target
  });

  it('skips rivers and walls (separate producers) and too-short edges', () => {
    const graph: RoadGraph = {
      nodes: [],
      edges: [
        roadEdge('river', STRAIGHT, { feature: 'river' }),
        roadEdge('wall', STRAIGHT, { feature: 'wall' }),
        roadEdge('stub', [{ x: 3, y: 3 }]),
      ],
    };
    expect(buildRoadDeformations(mapWith(), graph)).toHaveLength(0);
  });

  it('the corridor footprint covers the road centerline and fades beyond it', () => {
    const graph: RoadGraph = { nodes: [], edges: [roadEdge('e1', STRAIGHT, { class: 'highway', surface: 'stone' })] };
    const def = buildRoadDeformations(mapWith(), graph)[0];
    // On the line: strong pull (the cut strength). Far away: untouched.
    expect(def.mask(13, 16)).toBeGreaterThan(0.3);
    expect(def.mask(13, 25)).toBe(0);
  });
});

describe('construction drives how hard the road cuts', () => {
  it('a stone highway pulls harder to grade than a dirt footpath', () => {
    const hw = buildRoadDeformations(mapWith(), {
      nodes: [],
      edges: [roadEdge('hw', STRAIGHT, { class: 'highway', surface: 'stone' })],
    })[0];
    const path = buildRoadDeformations(mapWith(), {
      nodes: [],
      edges: [roadEdge('pf', STRAIGHT, { class: 'path', surface: 'dirt' })],
    })[0];
    // The level mask peak IS the cut strength — the highway commits far more earth-moving.
    expect(hw.mask(13, 16)).toBeGreaterThan(path.mask(13, 16));
  });
});

describe('composed heightfield', () => {
  it('is byte-identical (same instance) to base when there is no road graph', () => {
    const map = mapWith();
    const base = getHeightfield(map.seed, map.width, map.height, undefined, null);
    expect(getComposedHeightfield(map)).toBe(base);
    expect(getRoadDeformationStore(map).size).toBe(0);
  });

  it('lifts the carriageway crown above base where a road runs', () => {
    const graph: RoadGraph = { nodes: [], edges: [roadEdge('e1', STRAIGHT, { class: 'road', surface: 'stone' })] };
    const map = mapWith(graph);
    const store = getRoadDeformationStore(map);
    expect(store.size).toBe(1);
    // At a mid-road tile the camber leaves the composed surface measurably off base.
    const tx = 13, ty = 16;
    const composed = heightAt(map, store, tx, ty);
    expect(Math.abs(composed - baseHeightAt(map, tx, ty))).toBeGreaterThan(1e-3);
  });

  it('produces a fresh composed array (not the base instance) when roads exist', () => {
    const map = mapWith({ nodes: [], edges: [roadEdge('e1', STRAIGHT)] });
    const base = getHeightfield(map.seed, map.width, map.height, undefined, null);
    expect(getComposedHeightfield(map)).not.toBe(base);
  });
});
