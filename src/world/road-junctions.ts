// src/world/road-junctions.ts
//
// Junction topology (Roads Slice 0b). The worldgen road graph records one edge per
// connection segment; where two roads CROSS or one tees into another (the reuse-affinity
// makes minor roads bundle onto trunks), the crossing is a shared *tile* but not yet a graph
// vertex. This pass derives the real topology: it splits road edges at shared cells and
// inserts `junction` nodes, so the graph is a proper network the connectome can project
// (roads → Portals between Zones, junctions = degree-≥3 Zones).
//
// NON-DESTRUCTIVE + pure: it returns a NEW graph and never mutates worldgen output, so the
// carve/rasterize byte-parity is untouched (a split only partitions the same polyline cells —
// their union is identical, so rasterizing the split graph reproduces the same tiles).

import type { RoadGraph, RoadNode, RoadEdge, RoadNodeKind } from '@/world/road-graph';

const KIND_RANK: Record<RoadNodeKind, number> = { poi: 3, junction: 2, end: 1, waypoint: 0 };
const cellKey = (x: number, y: number) => `${x},${y}`;

/**
 * Split every road edge at cells shared by ≥2 road edges, inserting `junction` nodes there.
 * Rivers/walls pass through unchanged (separate producers). Returns a new graph; the input is
 * not mutated. Deterministic. `width` is the grid width, used to assign each original bridge
 * cell (a grid index) to the sub-edge that contains it.
 */
export function splitRoadGraphAtJunctions(graph: RoadGraph, width = 0): RoadGraph {
  const roadEdges = graph.edges.filter((e) => e.feature === 'road' && e.polyline.length >= 2);
  const otherEdges = graph.edges.filter((e) => !(e.feature === 'road' && e.polyline.length >= 2));

  // Count how many distinct road edges include each cell.
  const ownerCount = new Map<string, number>();
  for (const e of roadEdges) {
    const seen = new Set<string>();
    for (const p of e.polyline) {
      const k = cellKey(p.x, p.y);
      if (seen.has(k)) continue; // a self-touching edge counts once
      seen.add(k);
      ownerCount.set(k, (ownerCount.get(k) ?? 0) + 1);
    }
  }
  const isJunctionCell = (x: number, y: number) => (ownerCount.get(cellKey(x, y)) ?? 0) >= 2;

  // Preserve the original endpoint nodes (poi/end/waypoint), keyed by coord, and let
  // junction promotion upgrade them. New nodes (created at interior junctions) append.
  const nodes: RoadNode[] = graph.nodes.map((n) => ({ ...n }));
  const nodeByCoord = new Map<string, RoadNode>();
  for (const n of nodes) nodeByCoord.set(cellKey(n.x, n.y), n);
  let nodeSeq = nodes.length;

  const nodeAt = (x: number, y: number, kind: RoadNodeKind): RoadNode => {
    const k = cellKey(x, y);
    const existing = nodeByCoord.get(k);
    if (existing) {
      if (KIND_RANK[kind] > KIND_RANK[existing.kind]) existing.kind = kind;
      return existing;
    }
    const node: RoadNode = { id: `rj${nodeSeq++}`, x, y, kind };
    nodeByCoord.set(k, node);
    nodes.push(node);
    return node;
  };

  const edges: RoadEdge[] = [];

  for (const e of roadEdges) {
    const bridgeSet = new Set(e.bridgeCells);
    const pts = e.polyline;
    const last = pts.length - 1;
    // Split indices: the two real endpoints + every interior junction cell.
    const cuts: number[] = [0];
    for (let i = 1; i < last; i++) {
      if (isJunctionCell(pts[i].x, pts[i].y)) cuts.push(i);
    }
    cuts.push(last);

    for (let c = 0; c < cuts.length - 1; c++) {
      const i0 = cuts[c];
      const i1 = cuts[c + 1];
      const sub = pts.slice(i0, i1 + 1);
      if (sub.length < 2) continue;

      // Endpoint kinds: keep the edge's own terminal kind at the true ends; interior
      // cuts are junctions.
      const aKind: RoadNodeKind = c === 0 ? endpointKind(graph, e.a) : 'junction';
      const bKind: RoadNodeKind = c === cuts.length - 2 ? endpointKind(graph, e.b) : 'junction';
      const aNode = nodeAt(sub[0].x, sub[0].y, aKind);
      const bNode = nodeAt(sub[sub.length - 1].x, sub[sub.length - 1].y, bKind);

      // Assign each original bridge cell (a grid index) to the sub-edge that contains it.
      const subBridges: number[] = [];
      if (width > 0 && bridgeSet.size) {
        for (const p of sub) {
          const idx = p.y * width + p.x;
          if (bridgeSet.has(idx)) subBridges.push(idx);
        }
        subBridges.sort((m, n) => m - n);
      }

      edges.push({
        ...e,
        id: `${e.id}#${c}`,
        a: aNode.id,
        b: bNode.id,
        polyline: sub,
        bridgeCells: subBridges,
      });
    }
  }

  // Append non-road edges untouched (their endpoint nodes are already in `nodes`).
  for (const e of otherEdges) edges.push({ ...e });

  return { nodes, edges, rev: graph.rev, evolvedAtTick: graph.evolvedAtTick };
}

function endpointKind(graph: RoadGraph, nodeId: string): RoadNodeKind {
  return graph.nodes.find((n) => n.id === nodeId)?.kind ?? 'end';
}

/** Count edges incident on each node id (degree) — a junction is degree ≥ 3. */
export function nodeDegrees(graph: RoadGraph): Map<string, number> {
  const deg = new Map<string, number>();
  for (const e of graph.edges) {
    deg.set(e.a, (deg.get(e.a) ?? 0) + 1);
    deg.set(e.b, (deg.get(e.b) ?? 0) + 1);
  }
  return deg;
}
