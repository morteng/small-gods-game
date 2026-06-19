// src/world/road-graph.ts
//
// Roads Slice 0 — "promote the polyline" to a first-class world road graph.
//
// Today worldgen walks a path between connected POIs (`walkRoad`) and then
// *drops* the resulting polyline straight into the tile grid. This module makes
// the GRAPH the source of truth: `buildRoadGraph` captures every connection's
// walked polyline (+ bridge cells) as a `RoadEdge`, and `rasterizeRoadGraph` /
// `applyRoadMask` are the PURE derivation that turns the graph back into road
// tiles. The tile mask is always *derived*, never the truth.
//
// Faithfulness note: `walkRoad`'s cost model distinguishes only water vs
// non-water terrain, and two carve mutations flip a cell's water-ness for later
// segments — bridging (water → `bridge`, now cheap) and river-carving (land →
// `river`, now water). So a later segment's least-cost path can depend on an
// earlier segment's carve. `buildRoadGraph` therefore interleaves walk-and-carve
// per segment, exactly like the original inline loop, guaranteeing byte-identical
// worldgen output. `rasterizeRoadGraph` + `applyRoadMask` replay the recorded
// edges in the same order, so re-deriving the mask on a fresh tile grid
// reproduces the same roads.
//
// Slice-0 scope (see docs/superpowers/specs/2026-06-14-roads-slice0-…): captures
// the network worldgen already produces. NO junction splitting (edges stay
// whole), a single road `class`, and includes seed-authored rivers/walls so the
// rasterizer wholly owns `carveConnections`. Hierarchy tiering, hydrology-
// generated rivers, routing, rendering, and Portal unification are later slices.

import type { Connection, POI, Tile, TerrainField } from '@/core/types';
import { WATER_TYPES } from '@/core/constants';
import { walkRoad } from '@/terrain/road-walker';

/** Road hierarchy — a type label on the edge (Slice 4 fills the tiers). */
export type RoadClass = 'highway' | 'road' | 'track' | 'path';
/** What kind of linear feature an edge is (mirrors `Connection.type`/`RenderEdge`). */
export type LinearFeature = 'road' | 'river' | 'wall';
/** Tile surface an edge carves; maps to a concrete tile type at raster time. */
export type RoadSurface = 'dirt' | 'stone' | 'water';
/** Node rank in the graph. Slice 0 emits only `poi` / `waypoint` / `end`. */
export type RoadNodeKind = 'poi' | 'junction' | 'waypoint' | 'end';

export interface RoadNode {
  id: string;
  x: number;
  y: number;
  kind: RoadNodeKind;
  /** Set when `kind === 'poi'`: the POI this node stands on. */
  poiRef?: string;
}

export interface RoadEdge {
  id: string;
  /** Endpoint node ids. */
  a: string;
  b: string;
  /** The walked cell path — the SOURCE OF TRUTH for this edge's geometry. */
  polyline: { x: number; y: number }[];
  feature: LinearFeature;
  /** Hierarchy label (Slice 0 stamps a single class; Slice 4 tiers them). */
  class: RoadClass;
  surface: RoadSurface;
  /** Grid indices (`y * width + x`) the walker chose to bridge over water. Sorted. */
  bridgeCells: number[];
}

export interface RoadGraph {
  nodes: RoadNode[];
  edges: RoadEdge[];
}

/** A single tile write produced by rasterizing the graph. */
export interface RoadWrite {
  x: number;
  y: number;
  surface: RoadSurface;
  bridge: boolean;
}

/** Pure projection of a `RoadGraph` onto the grid: an ordered write stream. */
export interface RoadMask {
  width: number;
  height: number;
  /** Writes in edge order, then cell order — last write wins per cell. */
  writes: RoadWrite[];
}


function featureOf(type: Connection['type']): LinearFeature {
  return type; // 'road' | 'river' | 'wall' — identical vocabulary
}

// ── Slice 4: tier a road by the SIGNIFICANCE of the places it joins ──────────
// A road carries traffic proportional to its endpoints, so its hierarchy (and
// thus its width, surface detail, and how hard it carves the ground) follows the
// more significant end: a spur off a great town is a real road even where it
// reaches a hamlet; a lane between two hamlets is a track or footpath. We read
// `importance` first, then fall back to settlement `size`, then a neutral middle.
const IMPORTANCE_RANK: Record<string, number> = { low: 0, medium: 1, high: 2, critical: 3 };
const SIZE_RANK: Record<string, number> = { small: 0, medium: 1, large: 2, huge: 3 };

function poiRank(poi: POI | undefined): number {
  if (poi?.importance) return IMPORTANCE_RANK[poi.importance] ?? 1;
  if (poi?.size) return SIZE_RANK[poi.size] ?? 1;
  return 1; // unknown → a plain 'road'-grade middle
}

/** Road class from the busier endpoint: huge→highway … small→footpath. */
function classForConnection(from: POI | undefined, to: POI | undefined): RoadClass {
  const r = Math.max(poiRank(from), poiRank(to));
  return r >= 3 ? 'highway' : r >= 2 ? 'road' : r >= 1 ? 'track' : 'path';
}

function surfaceOf(conn: Connection): RoadSurface {
  if (conn.type === 'river') return 'water';
  return conn.style === 'stone' ? 'stone' : 'dirt';
}

/** Surface → concrete tile type (matches the original inline carve). */
function tileTypeOf(surface: RoadSurface): string {
  return surface === 'water' ? 'river' : surface === 'stone' ? 'stone_road' : 'dirt_road';
}

/**
 * Build the world road graph from seed connections, capturing each connection
 * segment's walked polyline as a `RoadEdge`.
 *
 * MUTATES `tiles`: it carves each segment before walking the next, because a
 * later segment's path cost depends on earlier carves (bridge/river flip
 * water-ness). This reproduces the original inline `carveConnections` loop
 * byte-for-byte while recording the graph. The carved tiles ARE the worldgen
 * output; `rasterizeRoadGraph` can re-derive them later from the returned graph.
 */
export function buildRoadGraph(
  connections: Connection[] | undefined,
  pois: POI[],
  tiles: Tile[][],
  fields: TerrainField,
  opts: { isObstacle?: (x: number, y: number) => boolean } = {},
): RoadGraph {
  const graph: RoadGraph = { nodes: [], edges: [] };
  if (!connections?.length) return graph;

  const width = tiles[0]?.length ?? 0;

  // POI position → id, for tagging poi nodes.
  const poiAt = new Map<string, string>();
  for (const p of pois) {
    if (p.position) poiAt.set(`${p.position.x},${p.position.y}`, p.id);
  }

  // Dedupe nodes by coordinate so a shared endpoint becomes one node.
  const nodeByCoord = new Map<string, RoadNode>();
  let nodeSeq = 0;
  const KIND_RANK: Record<RoadNodeKind, number> = { poi: 3, junction: 2, end: 1, waypoint: 0 };
  const nodeFor = (x: number, y: number, terminal: boolean): RoadNode => {
    const key = `${x},${y}`;
    const poiRef = poiAt.get(key);
    const kind: RoadNodeKind = poiRef ? 'poi' : terminal ? 'end' : 'waypoint';
    const existing = nodeByCoord.get(key);
    if (existing) {
      // Promote to the stronger kind if this occurrence is more significant.
      if (KIND_RANK[kind] > KIND_RANK[existing.kind]) {
        existing.kind = kind;
        if (poiRef) existing.poiRef = poiRef;
      }
      return existing;
    }
    const node: RoadNode = { id: `rn${nodeSeq++}`, x, y, kind };
    if (poiRef) node.poiRef = poiRef;
    nodeByCoord.set(key, node);
    graph.nodes.push(node);
    return node;
  };

  let edgeSeq = 0;

  for (const conn of connections) {
    const feature = featureOf(conn.type);
    const surface = surfaceOf(conn);
    const autoBridge = conn.autoBridge ?? (conn.type !== 'river');
    // Tier roads by their endpoints' significance; rivers/walls keep the neutral
    // label (their look comes from the feature, not the class).
    const roadClass: RoadClass =
      feature === 'road'
        ? classForConnection(
            pois.find((p) => p.id === conn.from),
            pois.find((p) => p.id === conn.to),
          )
        : 'road';

    // Same point sequence the original loop used: explicit waypoints if given,
    // else the two POI endpoints.
    let points: { x: number; y: number }[];
    if (conn.waypoints?.length) {
      points = conn.waypoints;
    } else {
      const from = pois.find(p => p.id === conn.from)?.position;
      const to = pois.find(p => p.id === conn.to)?.position;
      if (!from || !to) continue;
      points = [from, to];
    }

    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      // Roads route AROUND buildings (placed before this carve) instead of
      // bulldozing them — they thread the settlement's streets to reach a
      // waypoint. Rivers/walls ignore the obstacle (only roads obey it).
      const isObstacle = feature === 'road' ? opts.isObstacle : undefined;
      const result = walkRoad(a, b, tiles, fields, { autoBridge, isObstacle });
      if (result.cells.length === 0) continue;

      // The cost model steers AROUND buildings; this drops the residual cells it
      // was forced onto (a forced crossing, or the POI-centre endpoint the
      // building covers) so no road tile is ever carved under a building. The
      // polyline IS the source of truth, so carve and replay stay byte-identical.
      const cells = isObstacle ? result.cells.filter(c => !isObstacle(c.x, c.y)) : result.cells;
      if (cells.length === 0) continue;

      const bridgeCells = [...result.bridgeCells].sort((m, n) => m - n);
      const edge: RoadEdge = {
        id: `re${edgeSeq++}`,
        a: nodeFor(a.x, a.y, i === 0).id,
        b: nodeFor(b.x, b.y, i === points.length - 2).id,
        polyline: cells.map(c => ({ x: c.x, y: c.y })),
        feature,
        class: roadClass, // Slice 4: tiered by endpoint significance (see classForConnection).
        surface,
        bridgeCells,
      };
      graph.edges.push(edge);

      // Carve this segment immediately so the next walkRoad sees it (parity).
      applyEdge(tiles, edge, width);
    }
  }

  return graph;
}

/** Apply one edge's writes to live tiles (the per-cell rule from carveConnections). */
function applyEdge(tiles: Tile[][], edge: RoadEdge, width: number): void {
  const bridges = new Set(edge.bridgeCells);
  const roadTile = tileTypeOf(edge.surface);
  for (const cell of edge.polyline) {
    const t = tiles[cell.y]?.[cell.x];
    if (!t) continue;
    const idx = cell.y * width + cell.x;
    if (bridges.has(idx)) {
      t.type = 'bridge';
      t.walkable = true;
    } else if (WATER_TYPES.has(t.type)) {
      // Walker chose to stop at water (autoBridge=false); leave it untouched.
      continue;
    } else {
      t.type = roadTile;
      t.walkable = roadTile !== 'river';
    }
  }
}

/**
 * Pure projection: graph → ordered write stream. Same graph ⇒ same mask.
 * Does NOT touch tiles; the water-skip rule is applied at `applyRoadMask` time
 * because it depends on live tile state (and prior writes in the same stream).
 */
export function rasterizeRoadGraph(graph: RoadGraph, width: number, height: number): RoadMask {
  const writes: RoadWrite[] = [];
  for (const edge of graph.edges) {
    const bridges = new Set(edge.bridgeCells);
    for (const cell of edge.polyline) {
      writes.push({
        x: cell.x,
        y: cell.y,
        surface: edge.surface,
        bridge: bridges.has(cell.y * width + cell.x),
      });
    }
  }
  return { width, height, writes };
}

/**
 * Replay a `RoadMask` onto tiles — the derived road carve. Re-running this on a
 * fresh worldgen tile grid reproduces the roads `buildRoadGraph` carved.
 */
export function applyRoadMask(tiles: Tile[][], mask: RoadMask): void {
  for (const w of mask.writes) {
    const t = tiles[w.y]?.[w.x];
    if (!t) continue;
    if (w.bridge) {
      t.type = 'bridge';
      t.walkable = true;
    } else if (WATER_TYPES.has(t.type)) {
      continue;
    } else {
      const roadTile = tileTypeOf(w.surface);
      t.type = roadTile;
      t.walkable = roadTile !== 'river';
    }
  }
}
