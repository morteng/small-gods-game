// src/world/road-connectome.ts
//
// Roads as connectome Portals (Roads Slice — "fully into the world connectome"). The same
// scale-free primitives the BUILDING connectome uses (Zone = node, Portal = edge) describe the
// WORLD: a settlement/junction is a Zone, a road is a Portal carrying its spline + class +
// live dynamics in `attrs`. This projection makes the road graph a first-class connectome at
// world scale, so the world is "one composable, scale-free connectome" (VISION) rather than a
// bespoke road structure bolted on.
//
// Pure READ projection — it does not mutate the road graph or re-carve anything. Pair with
// {@link splitRoadGraphAtJunctions} first to get real junction Zones (degree-≥3).

import type { RoadGraph, RoadNode } from '@/world/road-graph';
import type { POI, GameMap } from '@/core/types';
import type { Connectome, Zone, Portal } from '@/blueprint/connectome/types';
import { splitRoadGraphAtJunctions } from '@/world/road-junctions';

export interface RoadConnectomeOptions {
  /** POIs to enrich settlement Zones with type/importance/size; matched by node.poiRef. */
  pois?: POI[];
}

/**
 * Project a road graph to a world-scale {@link Connectome}: every node → a Zone, every road
 * edge → a Portal between the Zones its endpoints resolve to (a POI node resolves to its POI
 * Zone, so two roads into a town share that town's Zone). Rivers/walls are skipped — they are
 * separate producers, not road Portals. Deterministic.
 */
export function roadGraphToConnectome(graph: RoadGraph, opts: RoadConnectomeOptions = {}): Connectome {
  const poiById = new Map((opts.pois ?? []).map((p) => [p.id, p]));
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));

  // A node resolves to a stable Zone id: its POI id if it sits on one, else the node id.
  const zoneIdOf = (node: RoadNode | undefined): string | undefined =>
    node ? (node.poiRef ?? node.id) : undefined;

  const zones = new Map<string, Zone>();
  for (const node of graph.nodes) {
    const id = zoneIdOf(node)!;
    if (zones.has(id)) continue;
    if (node.poiRef) {
      const poi = poiById.get(node.poiRef);
      zones.set(id, {
        id,
        type: poi?.type ?? 'settlement',
        fn: 'settlement',
        scale: 'settlement',
        attrs: { x: node.x, y: node.y, importance: poi?.importance, size: poi?.size },
      });
    } else {
      zones.set(id, {
        id,
        type: node.kind, // 'junction' | 'end' | 'waypoint'
        scale: 'world',
        attrs: { x: node.x, y: node.y },
      });
    }
  }

  const portals: Portal[] = [];
  for (const e of graph.edges) {
    if (e.feature !== 'road') continue;
    const from = zoneIdOf(nodeById.get(e.a));
    const to = zoneIdOf(nodeById.get(e.b));
    if (!from || !to) continue;
    portals.push({
      id: e.id,
      type: `road:${e.class}`,
      from,
      to,
      attrs: {
        surface: e.surface,
        roadClass: e.class,
        polyline: e.polyline,
        bridgeCells: e.bridgeCells,
        dynamics: e.dynamics,
      },
    });
  }

  return {
    scale: 'world',
    zones: [...zones.values()],
    portals,
    fixtures: [],
    source: { type: 'road-graph' },
  };
}

// ── The world-scale road connectome, memoised — the seam Fate/MCP/connectome views read ──
// Splits at junctions THEN projects, so junctions are real Zones. Keyed by (seed, dims, rev)
// so an evolving world (road-evolution bumps rev) refreshes its Portals' `dynamics`.

const cache = new Map<string, Connectome>();
const CACHE_CAP = 4;

/** The map's roads as a world-scale {@link Connectome} (junction-split, POI-enriched). Empty
 *  when the map has no road graph. Memoised; treat the result read-only. */
export function getRoadConnectome(map: GameMap): Connectome {
  const graph = map.roadGraph;
  if (!graph) return { scale: 'world', zones: [], portals: [], fixtures: [], source: { type: 'road-graph' } };
  const k = `${map.seed}:${map.width}x${map.height}:r${graph.rev ?? 0}`;
  const hit = cache.get(k);
  if (hit) return hit;
  const split = splitRoadGraphAtJunctions(graph, map.width);
  const c = roadGraphToConnectome(split, { pois: map.worldSeed?.pois ?? [] });
  cache.set(k, c);
  if (cache.size > CACHE_CAP) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return c;
}

/** Drop the memo (tests). */
export function clearRoadConnectomeCache(): void {
  cache.clear();
}
