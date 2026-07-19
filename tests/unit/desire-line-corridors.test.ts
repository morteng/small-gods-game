// tests/unit/desire-line-corridors.test.ts — S4 desire-line ADOPTION corridor tracing (the pure
// detection half). Builds a small synthetic GameMap + a TrampleGrid whose promoted set is
// hand-authored via the public `hydrate(TrampleSnapshot)` seam, plus a minimal RoadGraph, and pins
// that `traceAdoptionCorridors` finds the right anchors / path / log crossings deterministically.
import { describe, it, expect } from 'vitest';
import {
  traceAdoptionCorridors,
  ADOPT_ANCHOR_REACH_T,
  ADOPT_MIN_PATH_CELLS,
  N_ADOPT,
  type CorridorLogSite,
  type AdoptionCandidate,
} from '@/world/desire-line-corridors';
import { TrampleGrid, type TrampleSnapshot } from '@/sim/trample';
import type { GameMap, Tile, POI } from '@/core/types';
import type { RoadGraph, RoadNode, RoadEdge } from '@/world/road-graph';

const W = 24, H = 16;
const WEAR = 150;

/** Grass map with a set of cells forced to `water` (walkable:false, as hydrology writes them). */
function mapWithWater(water: Array<[number, number]>): GameMap {
  const waterSet = new Set(water.map(([x, y]) => `${x},${y}`));
  const tiles: Tile[][] = Array.from({ length: H }, (_, y) =>
    Array.from({ length: W }, (_, x) => {
      const isW = waterSet.has(`${x},${y}`);
      return { type: isW ? 'water' : 'grass', x, y, walkable: !isW, state: 'realized' as const };
    }));
  return {
    tiles, width: W, height: H, villages: [], seed: 1, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [],
  } as unknown as GameMap;
}

const isWaterFor = (map: GameMap) => (x: number, y: number): boolean =>
  map.tiles[y]?.[x]?.type === 'water';

/** A TrampleGrid with exactly the given cells promoted (public snapshot seam); each carries WEAR. */
function gridWithPromoted(promoted: Array<[number, number]>): TrampleGrid {
  const snap: TrampleSnapshot = {
    width: W, height: H,
    cells: promoted.map(([x, y]) => [y * W + x, WEAR] as [number, number]),
    promoted: promoted.map(([x, y]) => [y * W + x, 'grass'] as [number, string]),
  };
  const g = new TrampleGrid(W, H);
  g.hydrate(snap);
  return g;
}

function mkNode(id: string, x: number, y: number, kind: RoadNode['kind'] = 'poi', poiRef?: string): RoadNode {
  const n: RoadNode = { id, x, y, kind };
  if (poiRef) n.poiRef = poiRef;
  return n;
}
function mkEdge(id: string, a: string, b: string, polyline: Array<[number, number]>): RoadEdge {
  return {
    id, a, b,
    polyline: polyline.map(([x, y]) => ({ x, y })),
    feature: 'road', class: 'path', surface: 'dirt', bridgeCells: [],
  };
}
function graphOf(nodes: RoadNode[], edges: RoadEdge[] = []): RoadGraph {
  return { nodes, edges };
}

/** Horizontal promoted run [x0..x1] at row y. */
function hrun(y: number, x0: number, x1: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let x = x0; x <= x1; x++) out.push([x, y]);
  return out;
}

function is4Connected(path: { x: number; y: number }[]): boolean {
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) !== 1) return false;
  }
  return true;
}
const findAnchor = (c: AdoptionCandidate, kind: string) => c.anchors.find((a) => a.kind === kind);

describe('traceAdoptionCorridors', () => {
  it('exports the spec constants', () => {
    expect(ADOPT_ANCHOR_REACH_T).toBe(3);
    expect(ADOPT_MIN_PATH_CELLS).toBe(6);
    expect(N_ADOPT).toBe(4);
  });

  it('1) a straight promoted trail between two POI-node anchors → one candidate', () => {
    const map = mapWithWater([]);
    const trample = gridWithPromoted(hrun(5, 2, 8)); // 7 promoted cells
    const graph = graphOf([
      mkNode('nA', 2, 5, 'poi', 'poiA'),
      mkNode('nB', 8, 5, 'poi', 'poiB'),
    ]);
    const out = traceAdoptionCorridors(trample, map, graph, { isWater: isWaterFor(map) });

    expect(out).toHaveLength(1);
    const c = out[0];
    expect(c.key).toBe('adopt:nA~nB'); // identities sorted + joined
    // Both anchors are graph nodes carrying their poi ref.
    expect(c.anchors.map((a) => a.kind).sort()).toEqual(['node', 'node']);
    const a = findAnchor(c, 'node')!;
    if (a.kind === 'node') expect(a.poiId).toBeDefined();
    // Endpoints are the anchor cells; the path is the 7-cell trail, 4-connected.
    expect(c.path[0]).toEqual(c.anchors[0].cell);
    expect(c.path[c.path.length - 1]).toEqual(c.anchors[1].cell);
    expect(new Set([`${c.path[0].x},${c.path[0].y}`, `${c.path[c.path.length - 1].x},${c.path[c.path.length - 1].y}`]))
      .toEqual(new Set(['2,5', '8,5']));
    expect(c.path).toHaveLength(7);
    expect(is4Connected(c.path)).toBe(true);
    expect(c.bridgeIndices).toEqual([]);
    expect(c.logCorridorIds).toEqual([]);
    expect(c.meanWear).toBe(WEAR);
  });

  it('2) a trail ending near the MIDDLE of an existing road edge → interior edge anchor', () => {
    const map = mapWithWater([]);
    const trample = gridWithPromoted(hrun(5, 2, 8)); // ends (2,5) & (8,5)
    const graph = graphOf(
      [mkNode('rn0', 10, 0, 'end'), mkNode('rn1', 10, 10, 'end'), mkNode('nStart', 2, 5, 'poi', 'p0')],
      [mkEdge('re0', 'rn0', 'rn1', Array.from({ length: 11 }, (_, i) => [10, i] as [number, number]))],
    );
    const out = traceAdoptionCorridors(trample, map, graph, { isWater: isWaterFor(map) });

    expect(out).toHaveLength(1);
    const c = out[0];
    const edgeAnchor = findAnchor(c, 'edge');
    expect(edgeAnchor).toBeDefined();
    if (edgeAnchor?.kind === 'edge') {
      expect(edgeAnchor.edgeId).toBe('re0');
      // Cells (10,3..7) all sit at Chebyshev 2 from (8,5); the deterministic tie-break keeps the
      // SMALLEST polyline index → (10,3), index 3 — strictly interior (1..len-2 = 1..9).
      expect(edgeAnchor.index).toBe(3);
      expect(edgeAnchor.index).toBeGreaterThanOrEqual(1);
      expect(edgeAnchor.index).toBeLessThanOrEqual(9);
      expect(edgeAnchor.cell).toEqual({ x: 10, y: 3 });
    }
    // The other end binds the poi node; key uses edgeId (not index) + nodeId, sorted.
    expect(c.key).toBe('adopt:nStart~re0');
    expect(is4Connected(c.path)).toBe(true);
  });

  it('2b) a trail ending near an edge ENDPOINT resolves to the node, never an edge index-0 anchor', () => {
    const map = mapWithWater([]);
    const trample = gridWithPromoted(hrun(2, 2, 8)); // row y=2, end (8,2) near endpoint (10,0)
    const graph = graphOf(
      [mkNode('rn0', 10, 0, 'end'), mkNode('rn1', 10, 10, 'end'), mkNode('nStart', 2, 2, 'poi', 'p0')],
      [mkEdge('re0', 'rn0', 'rn1', Array.from({ length: 11 }, (_, i) => [10, i] as [number, number]))],
    );
    const out = traceAdoptionCorridors(trample, map, graph, { isWater: isWaterFor(map) });

    expect(out).toHaveLength(1);
    const c = out[0];
    // No edge anchor at all — the near end resolves to the endpoint NODE.
    expect(c.anchors.some((a) => a.kind === 'edge')).toBe(false);
    const rn0 = c.anchors.find((a) => a.kind === 'node' && a.nodeId === 'rn0');
    expect(rn0).toBeDefined();
  });

  it('3) an off-graph POI (no node on its cell) binds as a poi anchor', () => {
    const map = mapWithWater([]);
    const trample = gridWithPromoted(hrun(5, 2, 8)); // end (8,5) near the mill
    const graph = graphOf([mkNode('nStart', 2, 5, 'poi', 'p0')]); // node only at the far end
    const pois: POI[] = [{ id: 'mill', type: 'mill', position: { x: 10, y: 5 } }];
    const out = traceAdoptionCorridors(trample, map, graph, { isWater: isWaterFor(map), pois });

    expect(out).toHaveLength(1);
    const c = out[0];
    const poiAnchor = findAnchor(c, 'poi');
    expect(poiAnchor).toBeDefined();
    if (poiAnchor?.kind === 'poi') {
      expect(poiAnchor.poiId).toBe('mill');
      expect(poiAnchor.cell).toEqual({ x: 10, y: 5 });
    }
    expect(c.key).toBe('adopt:mill~nStart');
  });

  it('4) a log jump joins two promoted banks across water into ONE candidate', () => {
    // Left trail x=1..6 (y=5), water x=7,8, right trail x=9..14. Banks (6,5)&(9,5).
    const map = mapWithWater([[7, 5], [8, 5]]);
    const trample = gridWithPromoted([...hrun(5, 1, 6), ...hrun(5, 9, 14)]);
    const graph = graphOf([
      mkNode('nA', 1, 5, 'poi', 'poiA'),
      mkNode('nB', 14, 5, 'poi', 'poiB'),
    ]);
    const logSites: CorridorLogSite[] = [{
      corridorId: 'log0',
      banks: [{ x: 6, y: 5 }, { x: 9, y: 5 }],
      water: [{ x: 7, y: 5 }, { x: 8, y: 5 }],
    }];
    const out = traceAdoptionCorridors(trample, map, graph, { isWater: isWaterFor(map), logSites });

    expect(out).toHaveLength(1);
    const c = out[0];
    expect(c.key).toBe('adopt:nA~nB');
    // The path crosses the water via the log.
    const inPath = (x: number, y: number) => c.path.some((p) => p.x === x && p.y === y);
    expect(inPath(7, 5)).toBe(true);
    expect(inPath(8, 5)).toBe(true);
    expect(c.logCorridorIds).toEqual(['log0']);
    expect(c.bridgeIndices).toHaveLength(2);
    // bridgeIndices point at the water cells.
    for (const i of c.bridgeIndices) {
      expect(map.tiles[c.path[i].y][c.path[i].x].type).toBe('water');
    }
    expect(is4Connected(c.path)).toBe(true);
    expect(c.meanWear).toBe(WEAR); // water/connector cells excluded from the mean
  });

  it('4b) the SAME layout WITHOUT the log → two disconnected components, no joined candidate', () => {
    const map = mapWithWater([[7, 5], [8, 5]]);
    const trample = gridWithPromoted([...hrun(5, 1, 6), ...hrun(5, 9, 14)]);
    const graph = graphOf([
      mkNode('nA', 1, 5, 'poi', 'poiA'),
      mkNode('nB', 14, 5, 'poi', 'poiB'),
    ]);
    // No node binds the inner bank of either side, so neither 6-cell half yields its own candidate.
    const out = traceAdoptionCorridors(trample, map, graph, { isWater: isWaterFor(map) });
    expect(out).toHaveLength(0);
  });

  it('5) a component shorter than ADOPT_MIN_PATH_CELLS is excluded', () => {
    const map = mapWithWater([]);
    const trample = gridWithPromoted(hrun(5, 2, 6)); // 5 cells < 6
    const graph = graphOf([mkNode('nA', 2, 5, 'poi', 'poiA'), mkNode('nB', 6, 5, 'poi', 'poiB')]);
    const out = traceAdoptionCorridors(trample, map, graph, { isWater: isWaterFor(map) });
    expect(out).toHaveLength(0);
  });

  it('6) a trail whose both ends bind the SAME anchor is not a road (excluded)', () => {
    const map = mapWithWater([]);
    const trample = gridWithPromoted(hrun(5, 2, 7)); // 6 cells; ends (2,5)&(7,5)
    // A single node reachable (Chebyshev ≤3) from BOTH ends and nothing else.
    const graph = graphOf([mkNode('nOnly', 5, 2, 'end')]);
    const out = traceAdoptionCorridors(trample, map, graph, { isWater: isWaterFor(map) });
    expect(out).toHaveLength(0);
  });

  it('7) determinism: two identical runs are deep-equal, output sorted by key', () => {
    const build = () => {
      const map = mapWithWater([]);
      const trample = gridWithPromoted([...hrun(5, 2, 8), ...hrun(10, 2, 8)]);
      const graph = graphOf([
        mkNode('nA', 2, 5, 'poi', 'pa'), mkNode('nB', 8, 5, 'poi', 'pb'),
        mkNode('nC', 2, 10, 'poi', 'pc'), mkNode('nD', 8, 10, 'poi', 'pd'),
      ]);
      return traceAdoptionCorridors(trample, map, graph, { isWater: isWaterFor(map) });
    };
    const a = build();
    const b = build();
    expect(a).toEqual(b);
    expect(a).toHaveLength(2);
    const ids = a.map((c) => c.key);
    expect(ids).toEqual([...ids].sort());
  });

  it('7b) transpose stability: a vertical trail yields a structurally identical candidate', () => {
    const map = mapWithWater([]);
    const vrun: Array<[number, number]> = [];
    for (let y = 2; y <= 8; y++) vrun.push([5, y]);
    const trample = gridWithPromoted(vrun);
    const graph = graphOf([mkNode('nA', 5, 2, 'poi', 'pa'), mkNode('nB', 5, 8, 'poi', 'pb')]);
    const out = traceAdoptionCorridors(trample, map, graph, { isWater: isWaterFor(map) });
    expect(out).toHaveLength(1);
    const c = out[0];
    expect(c.key).toBe('adopt:nA~nB');
    expect(c.path).toHaveLength(7);
    expect(is4Connected(c.path)).toBe(true);
    expect(c.meanWear).toBe(WEAR);
  });

  it('8) a wobbly (zig-zag) trail still produces a 4-connected path end to end', () => {
    const map = mapWithWater([]);
    // (2,5)-(3,5)-(4,5)-(4,6)-(4,7)-(5,7)-(6,7): 7 cells, 4-connected, ends (2,5)&(6,7).
    const trample = gridWithPromoted([[2, 5], [3, 5], [4, 5], [4, 6], [4, 7], [5, 7], [6, 7]]);
    const graph = graphOf([mkNode('nA', 2, 5, 'poi', 'pa'), mkNode('nB', 6, 7, 'poi', 'pb')]);
    const out = traceAdoptionCorridors(trample, map, graph, { isWater: isWaterFor(map) });
    expect(out).toHaveLength(1);
    const c = out[0];
    expect(is4Connected(c.path)).toBe(true);
    expect(new Set([`${c.path[0].x},${c.path[0].y}`, `${c.path[c.path.length - 1].x},${c.path[c.path.length - 1].y}`]))
      .toEqual(new Set(['2,5', '6,7']));
    expect(c.path).toHaveLength(7);
  });

  it('9) default isWater falls back to WATER_TYPES over the tile grid', () => {
    // No explicit isWater passed — the log jump must still fire using the tile-type default.
    const map = mapWithWater([[7, 5], [8, 5]]);
    const trample = gridWithPromoted([...hrun(5, 1, 6), ...hrun(5, 9, 14)]);
    const graph = graphOf([mkNode('nA', 1, 5, 'poi', 'poiA'), mkNode('nB', 14, 5, 'poi', 'poiB')]);
    const logSites: CorridorLogSite[] = [{
      corridorId: 'log0', banks: [{ x: 6, y: 5 }, { x: 9, y: 5 }], water: [{ x: 7, y: 5 }, { x: 8, y: 5 }],
    }];
    const out = traceAdoptionCorridors(trample, map, graph, { logSites });
    expect(out).toHaveLength(1);
    expect(out[0].bridgeIndices).toHaveLength(2);
  });
});
