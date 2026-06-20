import { describe, it, expect } from 'vitest';
import { buildRoadRibbonMesh, BRIDGE_TAG, roadTier } from '@/render/ribbon/road-ribbon-field';
import { RIBBON_FLOATS_PER_VERTEX as STRIDE } from '@/render/ribbon/ribbon-geometry';
import { clearHeightfieldCache } from '@/world/heightfield';
import { clearRoadDeformationCache } from '@/world/road-deformation';
import type { GameMap } from '@/core/types';
import type { RoadGraph, RoadEdge } from '@/world/road-graph';

const W = 24, H = 24;

function roadEdge(id: string, polyline: { x: number; y: number }[], partial: Partial<RoadEdge> = {}): RoadEdge {
  return {
    id, a: `${id}-a`, b: `${id}-b`, polyline,
    feature: 'road', class: 'road', surface: 'dirt', bridgeCells: [], ...partial,
  };
}

function mapWith(graph: RoadGraph): GameMap {
  return { seed: 7, width: W, height: H, roadGraph: graph } as unknown as GameMap;
}

// Vertex float offsets within a stride-10 vertex.
const SPEED = 7, TAG1 = 9;

describe('roadTier', () => {
  it('maps stone→3, path→0, track→1, else→2', () => {
    expect(roadTier({ class: 'road', surface: 'stone' })).toBe(3);
    expect(roadTier({ class: 'path', surface: 'dirt' })).toBe(0);
    expect(roadTier({ class: 'track', surface: 'dirt' })).toBe(1);
    expect(roadTier({ class: 'highway', surface: 'dirt' })).toBe(2);
  });
});

describe('buildRoadRibbonMesh — bridges (R3b)', () => {
  function fresh() { clearHeightfieldCache(); clearRoadDeformationCache(); }

  it('a plain road carries tag.y=0 and speed=0 on every vertex', () => {
    fresh();
    const g: RoadGraph = { nodes: [], edges: [roadEdge('e', [{ x: 4, y: 4 }, { x: 5, y: 4 }, { x: 6, y: 4 }])] };
    const mesh = buildRoadRibbonMesh(g, mapWith(g));
    expect(mesh.vertexCount).toBeGreaterThan(0);
    for (let v = 0; v < mesh.vertexCount; v++) {
      expect(mesh.data[v * STRIDE + TAG1]).toBe(0);
      expect(mesh.data[v * STRIDE + SPEED]).toBe(0);
    }
  });

  it('a bridge span flags BRIDGE_TAG and bakes a deck elevation into speed', () => {
    fresh();
    // Straight crossing x=4..7 on row y=10; the middle two cells are bridged.
    const poly = [{ x: 4, y: 10 }, { x: 5, y: 10 }, { x: 6, y: 10 }, { x: 7, y: 10 }];
    const bridgeCells = [10 * W + 5, 10 * W + 6];
    const g: RoadGraph = { nodes: [], edges: [roadEdge('e', poly, { bridgeCells })] };
    const mesh = buildRoadRibbonMesh(g, mapWith(g));

    let bridgeVerts = 0;
    let deckSpeed = 0;
    for (let v = 0; v < mesh.vertexCount; v++) {
      if (Math.abs(mesh.data[v * STRIDE + TAG1] - BRIDGE_TAG) < 1e-6) {
        bridgeVerts++;
        deckSpeed = mesh.data[v * STRIDE + SPEED];
      }
    }
    // Force-keeping the bridge cells means the deck span is densely sampled → flagged.
    expect(bridgeVerts).toBeGreaterThan(0);
    expect(deckSpeed).not.toBe(0); // a real deck elevation was baked
  });

  it('without a map, bridges stay inert — back-compatible plain road', () => {
    fresh();
    const poly = [{ x: 4, y: 10 }, { x: 5, y: 10 }, { x: 6, y: 10 }];
    const g: RoadGraph = { nodes: [], edges: [roadEdge('e', poly, { bridgeCells: [10 * W + 5] })] };
    const mesh = buildRoadRibbonMesh(g); // no map → no deck
    for (let v = 0; v < mesh.vertexCount; v++) {
      expect(mesh.data[v * STRIDE + TAG1]).toBe(0);
      expect(mesh.data[v * STRIDE + SPEED]).toBe(0);
    }
  });
});
