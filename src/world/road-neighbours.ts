// src/world/road-neighbours.ts
//
// Road-graph neighbour helper — "which settlements can `poiId` reach within N road hops?".
// A thin, pure READ projection over `map.roadGraph` (see `road-graph.ts`): a lexicographic
// (hops, then distance) shortest-path search where a "hop" is one POI→POI road link and
// intermediate junction/waypoint/end nodes are free pass-through. Deterministic + rng-free —
// this is a query helper, not a sim system, but it lives under `src/world/` alongside the
// graph it reads.
//
// Only `feature: 'road'` edges are traversed (mirrors `road-connectome.ts`'s convention: the
// graph can also carry seed-authored river/wall edges for the rasterizer, which are not roads
// a settlement is "connected" by).

import type { GameMap } from '@/core/types';
import type { RoadEdge, RoadGraph, RoadNode } from '@/world/road-graph';

export interface RoadNeighbour {
  poiId: string;
  hops: number;
  distTiles: number;
}

/** Lexicographic path cost: fewest hops wins, ties broken by shorter distance. */
interface PathCost {
  hops: number;
  dist: number;
}

function costIsBetter(a: PathCost, b: PathCost): boolean {
  if (a.hops !== b.hops) return a.hops < b.hops;
  return a.dist < b.dist;
}

function edgeLength(a: RoadNode, b: RoadNode): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Undirected adjacency over every node touched by a `feature: 'road'` edge. */
function buildAdjacency(graph: RoadGraph): Map<string, { to: string; dist: number }[]> {
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const adj = new Map<string, { to: string; dist: number }[]>();
  const link = (from: string, to: string, dist: number) => {
    let list = adj.get(from);
    if (!list) adj.set(from, (list = []));
    list.push({ to, dist });
  };
  for (const edge of graph.edges as RoadEdge[]) {
    if (edge.feature !== 'road') continue;
    const a = nodeById.get(edge.a);
    const b = nodeById.get(edge.b);
    if (!a || !b) continue; // malformed edge — skip rather than throw
    const dist = edgeLength(a, b);
    link(edge.a, edge.b, dist);
    link(edge.b, edge.a, dist);
  }
  return adj;
}

/**
 * Settlements road-connected to `poiId` within `maxHops` POI-to-POI links.
 * A "hop" counts each POI→POI segment; intermediate junction/waypoint/end nodes are
 * pass-through and do NOT count as hops. `distTiles` = summed Euclidean length (node.x/y)
 * of the shortest-by-hops path to that neighbour. Excludes `poiId` itself.
 * Deterministic & rng-free: BFS in hop order, results sorted by (hops, distTiles, poiId).
 * Returns [] if the map has no roadGraph or the poi has no node.
 */
export function roadNeighbours(map: GameMap, poiId: string, maxHops: number): RoadNeighbour[] {
  const graph = map.roadGraph;
  if (!graph || graph.nodes.length === 0) return [];

  // Deterministic start pick: the lexicographically smallest node id among poi nodes
  // referencing `poiId` (normally exactly one; a graph with duplicates still resolves).
  const startCandidates = graph.nodes
    .filter((n) => n.kind === 'poi' && n.poiRef === poiId)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const start = startCandidates[0];
  if (!start) return [];

  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const adj = buildAdjacency(graph);

  // Lexicographic-Dijkstra: edge "weight" is (0, dist) through a junction/waypoint/end,
  // (1, dist) into a poi node. `best` prunes stale queue entries; `finalized` marks nodes
  // whose optimal (hops, dist) is settled (safe once popped, since weights only add).
  const best = new Map<string, PathCost>();
  const finalized = new Set<string>();
  const neighbours = new Map<string, PathCost>(); // poiId -> first (best) arrival

  type QueueEntry = { nodeId: string; cost: PathCost };
  const queue: QueueEntry[] = [{ nodeId: start.id, cost: { hops: 0, dist: 0 } }];
  best.set(start.id, { hops: 0, dist: 0 });

  while (queue.length > 0) {
    // Linear-scan extract-min: fine for the small per-query graphs this serves. Tie-break
    // on node id keeps pop order (and therefore nothing observable) fully deterministic.
    let minIdx = 0;
    for (let i = 1; i < queue.length; i++) {
      const a = queue[i].cost;
      const b = queue[minIdx].cost;
      if (costIsBetter(a, b) || (a.hops === b.hops && a.dist === b.dist && queue[i].nodeId < queue[minIdx].nodeId)) {
        minIdx = i;
      }
    }
    const { nodeId, cost } = queue.splice(minIdx, 1)[0];
    if (finalized.has(nodeId)) continue;
    finalized.add(nodeId);

    const node = nodeById.get(nodeId);
    if (!node) continue;

    if (node.kind === 'poi' && node.poiRef && node.poiRef !== poiId) {
      if (!neighbours.has(node.poiRef)) neighbours.set(node.poiRef, cost);
    }

    // Budget exhausted: any further poi reached from here would exceed maxHops. Junction/
    // waypoint pass-through never spends budget, but it can only ever lead to MORE poi
    // arrivals, so pruning here (rather than only at poi nodes) is still correct.
    if (cost.hops >= maxHops) continue;

    for (const { to, dist } of adj.get(nodeId) ?? []) {
      if (finalized.has(to)) continue;
      const toNode = nodeById.get(to);
      if (!toNode) continue;
      const nextCost: PathCost = {
        hops: toNode.kind === 'poi' ? cost.hops + 1 : cost.hops,
        dist: cost.dist + dist,
      };
      const known = best.get(to);
      if (known && !costIsBetter(nextCost, known)) continue;
      best.set(to, nextCost);
      queue.push({ nodeId: to, cost: nextCost });
    }
  }

  const result: RoadNeighbour[] = [...neighbours.entries()].map(([id, cost]) => ({
    poiId: id,
    hops: cost.hops,
    distTiles: cost.dist,
  }));

  result.sort((a, b) => {
    if (a.hops !== b.hops) return a.hops - b.hops;
    if (a.distTiles !== b.distTiles) return a.distTiles - b.distTiles;
    return a.poiId < b.poiId ? -1 : a.poiId > b.poiId ? 1 : 0;
  });

  return result;
}
