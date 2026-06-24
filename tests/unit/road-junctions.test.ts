import { describe, it, expect } from 'vitest';
import type { RoadGraph, RoadEdge, RoadNode } from '@/world/road-graph';
import { splitRoadGraphAtJunctions, nodeDegrees } from '@/world/road-junctions';
import { roadGraphToConnectome, getRoadConnectome, clearRoadConnectomeCache } from '@/world/road-connectome';
import type { GameMap } from '@/core/types';

function node(id: string, x: number, y: number, kind: RoadNode['kind'] = 'waypoint', poiRef?: string): RoadNode {
  return { id, x, y, kind, ...(poiRef ? { poiRef } : {}) };
}
function edge(id: string, a: string, b: string, polyline: { x: number; y: number }[], partial: Partial<RoadEdge> = {}): RoadEdge {
  return { id, a, b, polyline, feature: 'road', class: 'road', surface: 'dirt', bridgeCells: [], ...partial };
}
const line = (x0: number, y0: number, x1: number, y1: number): { x: number; y: number }[] => {
  const pts: { x: number; y: number }[] = [];
  const dx = Math.sign(x1 - x0), dy = Math.sign(y1 - y0);
  let x = x0, y = y0;
  pts.push({ x, y });
  while (x !== x1 || y !== y1) { if (x !== x1) x += dx; if (y !== y1) y += dy; pts.push({ x, y }); }
  return pts;
};

describe('splitRoadGraphAtJunctions', () => {
  it('leaves a lone road untouched (no crossings)', () => {
    const g: RoadGraph = { nodes: [node('a', 0, 0, 'poi', 'A'), node('b', 6, 0, 'poi', 'B')], edges: [edge('e', 'a', 'b', line(0, 0, 6, 0))] };
    const out = splitRoadGraphAtJunctions(g);
    expect(out.edges).toHaveLength(1);
    expect(out.edges[0].polyline).toEqual(g.edges[0].polyline);
  });

  it('splits two crossing roads into four edges meeting at one junction node', () => {
    // A horizontal road and a vertical road crossing at (3,0)…(3,?) — share cell (3,0).
    const horiz = edge('h', 'h0', 'h1', line(0, 0, 6, 0));
    const vert = edge('v', 'v0', 'v1', line(3, -3, 3, 3));
    const g: RoadGraph = {
      nodes: [node('h0', 0, 0, 'poi', 'A'), node('h1', 6, 0, 'poi', 'B'), node('v0', 3, -3, 'poi', 'C'), node('v1', 3, 3, 'poi', 'D')],
      edges: [horiz, vert],
    };
    const out = splitRoadGraphAtJunctions(g);
    expect(out.edges).toHaveLength(4); // each road cut once at the shared cell

    // Exactly one junction node, at the crossing, with degree 4.
    const junctions = out.nodes.filter((n) => n.kind === 'junction');
    expect(junctions).toHaveLength(1);
    expect(junctions[0]).toMatchObject({ x: 3, y: 0 });
    expect(nodeDegrees(out).get(junctions[0].id)).toBe(4);
  });

  it('the split is non-destructive: the union of sub-polyline cells equals the original', () => {
    const horiz = edge('h', 'h0', 'h1', line(0, 0, 6, 0));
    const vert = edge('v', 'v0', 'v1', line(3, -2, 3, 2));
    const g: RoadGraph = {
      nodes: [node('h0', 0, 0), node('h1', 6, 0), node('v0', 3, -2), node('v1', 3, 2)],
      edges: [horiz, vert],
    };
    const out = splitRoadGraphAtJunctions(g);
    const cellsOf = (es: RoadEdge[]) => new Set(es.flatMap((e) => e.polyline.map((p) => `${p.x},${p.y}`)));
    expect(cellsOf(out.edges)).toEqual(cellsOf(g.edges));
  });

  it('assigns bridge cells to the sub-edge that contains them (needs width)', () => {
    const width = 8;
    const idx = (x: number, y: number) => y * width + x;
    // Horizontal road with a bridge at (1,0); a vertical road crosses at (3,0).
    const horiz = edge('h', 'h0', 'h1', line(0, 0, 6, 0), { bridgeCells: [idx(1, 0)] });
    const vert = edge('v', 'v0', 'v1', line(3, 0, 3, 3));
    const g: RoadGraph = { nodes: [node('h0', 0, 0), node('h1', 6, 0), node('v0', 3, 0), node('v1', 3, 3)], edges: [horiz, vert] };
    const out = splitRoadGraphAtJunctions(g, width);
    const withBridge = out.edges.filter((e) => e.bridgeCells.includes(idx(1, 0)));
    expect(withBridge).toHaveLength(1); // the bridge lands on exactly one sub-edge
    expect(withBridge[0].polyline.some((p) => p.x === 1 && p.y === 0)).toBe(true);
  });

  it('is deterministic', () => {
    const g = (): RoadGraph => ({ nodes: [node('h0', 0, 0), node('h1', 6, 0), node('v0', 3, -2), node('v1', 3, 2)], edges: [edge('h', 'h0', 'h1', line(0, 0, 6, 0)), edge('v', 'v0', 'v1', line(3, -2, 3, 2))] });
    expect(splitRoadGraphAtJunctions(g())).toEqual(splitRoadGraphAtJunctions(g()));
  });
});

describe('roadGraphToConnectome', () => {
  it('projects nodes → Zones and road edges → Portals at world scale', () => {
    const g: RoadGraph = {
      nodes: [node('a', 0, 0, 'poi', 'town'), node('b', 6, 0, 'poi', 'keep')],
      edges: [edge('e', 'a', 'b', line(0, 0, 6, 0), { class: 'highway', surface: 'stone' })],
    };
    const c = roadGraphToConnectome(g, { pois: [{ id: 'town', type: 'village' }, { id: 'keep', type: 'castle' }] as never });
    expect(c.scale).toBe('world');
    expect(c.zones.map((z) => z.id).sort()).toEqual(['keep', 'town']);
    expect(c.zones.find((z) => z.id === 'town')!.type).toBe('village');
    expect(c.portals).toHaveLength(1);
    expect(c.portals[0]).toMatchObject({ from: 'town', to: 'keep', type: 'road:highway' });
    expect(c.portals[0].attrs!.surface).toBe('stone');
  });

  it('two roads into one town share that town Zone (Portal endpoints resolve to the POI)', () => {
    const g: RoadGraph = {
      nodes: [node('t', 3, 3, 'poi', 'town'), node('a', 0, 0, 'poi', 'A'), node('b', 6, 0, 'poi', 'B')],
      edges: [edge('e1', 'a', 't', line(0, 0, 3, 3)), edge('e2', 'b', 't', line(6, 0, 3, 3))],
    };
    const c = roadGraphToConnectome(g);
    expect(c.portals.filter((p) => p.to === 'town')).toHaveLength(2);
    expect(c.zones.filter((z) => z.id === 'town')).toHaveLength(1);
  });

  it('skips rivers/walls — only roads become Portals', () => {
    const g: RoadGraph = {
      nodes: [node('a', 0, 0), node('b', 6, 0)],
      edges: [edge('road', 'a', 'b', line(0, 0, 6, 0)), edge('river', 'a', 'b', line(0, 0, 6, 0), { feature: 'river', surface: 'water' })],
    };
    const c = roadGraphToConnectome(g);
    expect(c.portals).toHaveLength(1);
    expect(c.portals[0].id).toBe('road');
  });

  it('junction nodes from a split become junction Zones', () => {
    const g: RoadGraph = {
      nodes: [node('h0', 0, 0, 'poi', 'A'), node('h1', 6, 0, 'poi', 'B'), node('v0', 3, -3, 'poi', 'C'), node('v1', 3, 3, 'poi', 'D')],
      edges: [edge('h', 'h0', 'h1', line(0, 0, 6, 0)), edge('v', 'v0', 'v1', line(3, -3, 3, 3))],
    };
    const c = roadGraphToConnectome(splitRoadGraphAtJunctions(g));
    expect(c.zones.some((z) => z.type === 'junction')).toBe(true);
  });
});

describe('getRoadConnectome (memoised world-scale seam)', () => {
  function mapWith(graph?: RoadGraph): GameMap {
    return { seed: 7, width: 16, height: 16, roadGraph: graph, worldSeed: { pois: [{ id: 'A', type: 'village' }] } } as unknown as GameMap;
  }

  it('is empty for a graphless map', () => {
    clearRoadConnectomeCache();
    const c = getRoadConnectome(mapWith());
    expect(c.portals).toHaveLength(0);
    expect(c.zones).toHaveLength(0);
  });

  it('splits-then-projects and memoises by rev', () => {
    clearRoadConnectomeCache();
    const g: RoadGraph = {
      nodes: [node('a', 0, 0, 'poi', 'A'), node('b', 6, 0, 'poi', 'B')],
      edges: [edge('e', 'a', 'b', line(0, 0, 6, 0), { class: 'road', surface: 'stone' })],
      rev: 0,
    };
    const map = mapWith(g);
    const first = getRoadConnectome(map);
    expect(getRoadConnectome(map)).toBe(first); // same rev → memoised instance
    expect(first.portals).toHaveLength(1);

    g.rev = 1; // road-evolution bumped it
    expect(getRoadConnectome(map)).not.toBe(first); // rev moved → re-derived
  });
});
