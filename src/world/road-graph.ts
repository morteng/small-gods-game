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
// Faithfulness note: `walkRoad`'s cost model distinguishes water classes only by
// tile type (bridgeable river/shallow vs standing lake/deep/ocean, WCV 103), and
// two carve mutations flip a cell's water-ness for later
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
// generated rivers, and routing/rendering deepening are later slices. Portal
// unification SHIPPED: `road-connectome.ts` (`roadGraphToConnectome`) projects
// this graph onto the same scale-free Zone/Portal primitives the building
// connectome uses — settlements/junctions are Zones, roads are Portals.

import type { Connection, POI, Tile, TerrainField } from '@/core/types';
import { WATER_TYPES } from '@/core/constants';
import { walkRoad } from '@/terrain/road-walker';
import { gradeEnvelope, maxCarriageHalfWidth } from '@/world/road-state';

/** Carved road/bridge tile types — the reuse-affinity set (new roads bundle onto these).
 *  Exported so other road-graph-adjacent modules (e.g. the fillet↔raster reconciliation in
 *  `road-deformation.ts`) can recognise "already road" without re-deriving the set. */
export const ROAD_TILE_TYPES = new Set(['dirt_road', 'stone_road', 'bridge']);

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
  /** Time-varying state (age/condition/wear/overgrowth) accumulated by the road-evolution
   *  tick. Absent = a new, kept road. Persisted verbatim with the graph and consumed by the
   *  carve + surface channel via `edge.dynamics` (see {@link edgeRoadProfile}). */
  dynamics?: import('@/world/road-state').RoadDynamics;
  /** Set by `reconcileFilletRaster` when this edge's gate/anchor approach fillet could not be
   *  legalized onto the tile grid (a divergent span's candidate cells hit water-sans-bridge /
   *  curtain / building / green). Galin's re-validate verdict: the SMOOTHING is discarded, not
   *  partially applied — `edgeRoadProfile` then skips the fillet so the render ribbon, terrain
   *  carve and tile mask all follow the plain smoothed polyline the router approved
   *  (`roads.ribbon-legal` holds by construction). Persisted with the graph. */
  filletRejected?: boolean;
  /** Set by `reconcileCenterlineLegality` when this edge's degree-2 node-tangent fillet
   *  (S4 hairpin fix) swung the drawn line onto illegal ground and pinning could not heal
   *  it — the node fillet alone is discarded (gate/anchor fillets survive), one rung below
   *  the whole-edge `filletRejected` verdict. Persisted with the graph. */
  nodeTangentRejected?: boolean;
  /** Bow-reconciliation PINS (`reconcileCenterlineBows`): indices into `polyline` forced to
   *  stay spline control points. Where plain Catmull-Rom smoothing bowed further than the
   *  reconcile margin off the walked path (the "ribbon sags off the walkable row" class), the
   *  offending arc is re-fitted THROUGH the walked cells instead of stamping a doubled "lens"
   *  of extra tiles or leaving an illegal bow. Persisted with the graph; `edgeRoadProfile`
   *  honours them everywhere the centerline is derived. */
  pins?: number[];
}

export interface RoadGraph {
  nodes: RoadNode[];
  edges: RoadEdge[];
  /** Bumped whenever `edge.dynamics` change (road-evolution). Folded into the deformation
   *  + surface cache keys so an evolving world re-derives its carve/pavedness. */
  rev?: number;
  /** Sim tick the dynamics were last advanced to. Lives on the graph (not in the tick
   *  system) so evolution is stateless + replay/save-safe — the graph carries its own clock. */
  evolvedAtTick?: number;
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
  opts: {
    isObstacle?: (x: number, y: number) => boolean;
    /** Metre span of the `[0,1]` elevation field (`worldStyleOf(seed).mountainRelief`) —
     *  makes the walker's grade model PHYSICAL, so a styled high-relief world switchbacks
     *  where a default world climbs straight. Defaults to `TERRAIN_RELIEF_M` in the walker. */
    reliefM?: number;
  } = {},
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
      //
      // Widened by THIS edge's own worst-case carriageway half-width
      // (`maxCarriageHalfWidth`, road-state.ts — the same source `road-occupancy-mask.ts`
      // and `building-placer.ts` use): a bare 1-cell obstacle test let a new trunk edge's
      // centerline route right beside a building's wall, and the renderer's analytic ribbon
      // then painted pavement (up to ~1.44 tiles per side for a highway) INTO the building.
      // The dilated test still only vetoes cells the caller's `isObstacle` already flags
      // (a building/green), just checked over a square neighbourhood instead of one cell.
      const baseObstacle = feature === 'road' ? opts.isObstacle : undefined;
      const clearance = feature === 'road' ? Math.ceil(maxCarriageHalfWidth(roadClass)) : 0;
      const isObstacle = baseObstacle && clearance > 0
        ? (x: number, y: number): boolean => {
            for (let dy = -clearance; dy <= clearance; dy++) {
              for (let dx = -clearance; dx <= clearance; dx++) {
                if (baseObstacle(x + dx, y + dy)) return true;
              }
            }
            return false;
          }
        : baseObstacle;
      // Roads prefer to REUSE an already-carved road/bridge cell — so minor roads
      // bundle onto existing trunks and crossings concentrate at shared bridge sites
      // (walk-and-carve is interleaved, so earlier segments are already on `tiles`).
      const isRoad = feature === 'road' ? (x: number, y: number) => ROAD_TILE_TYPES.has(tiles[y]?.[x]?.type) : undefined;
      // Roads + rivers may step DIAGONALLY so they cut a true ANY-ANGLE line across the
      // terrain instead of an axis-aligned staircase. A 4-connected A* can only move on
      // the grid axes, so a line at e.g. 30° comes out as multi-tile W/N jogs that read
      // as grid-locked zig-zag — and the centerline smoother can't straighten them (RDP
      // keeps any jog >ε). An 8-connected path distributes the off-axis steps one-per-run,
      // staying ≤½ tile from the true bearing, so RDP+Catmull reconstruct the real angle.
      // Walls stay 4-connected (a corner-connected wall leaks). Diagonal water-corner cuts
      // are already guarded in the walker, so bridges stay sound.
      const allowDiagonal = feature !== 'wall';
      // G1 — per-class grade envelope: a highway demands a near-flat grade (switchbacks
      // hard, asks for cuts/embankments), a footpath takes a steeper line. Roads only;
      // rivers/walls keep the walker's neutral defaults so their routing is unchanged.
      const env = feature === 'road' ? gradeEnvelope(roadClass) : undefined;
      const result = walkRoad(a, b, tiles, fields, {
        autoBridge, isObstacle, isRoad, allowDiagonal,
        maxGrade: env?.maxGrade,
        overGradePenalty: env?.overGradePenalty,
        reliefM: opts.reliefM,
      });
      if (result.cells.length === 0) continue;

      // A diagonal step leaves the rasterized tile MASK only corner-connected, which
      // breaks the 4-neighbour invariants the network relies on (NPC walkability, the
      // road-connectivity flood). Re-insert an orthogonal corner at each diagonal step so
      // the stamped mask is 4-connected again — the polyline still traces the diagonal, so
      // the smoothed centerline (carve + surface) stays any-angle; only the 1-tile-wide
      // mask gains the filler. The filler prefers a land, non-obstacle cell so it never
      // spawns a phantom bridge or carves a building.
      const walked = allowDiagonal ? orthogonalize(result.cells, tiles, isObstacle) : result.cells;
      // The cost model steers AROUND buildings; this drops the residual cells it
      // was forced onto (a forced crossing, or the POI-centre endpoint the
      // building covers) so no road tile is ever carved under a building. The
      // polyline IS the source of truth, so carve and replay stay byte-identical.
      const cells = isObstacle ? walked.filter(c => !isObstacle(c.x, c.y)) : walked;
      if (cells.length === 0) continue;

      // Only a ROAD carries a bridge deck. The walker records every water cell on the
      // final path as a `bridgeCell` regardless of feature, so a river/wall edge that
      // happens to route through a foreign water cell (autoBridge is off for rivers, but
      // bridgeCells are still logged) would stamp a stray `bridge` TILE via applyEdge —
      // a deck the crossing detector (feature==='road' only) never realizes, i.e. a
      // bridge tile with no bridge_deck entity over it (the tiles-vs-deck class). Rivers
      // and walls don't bridge water: they merge with it / gap over it. So a non-road
      // edge claims no bridge cells — keeping the tile stamp and the crossing detector in
      // lockstep, and leaving that cell as its water/river tile.
      //
      // `orthogonalize` can insert a filler corner AFTER the walk already decided its
      // `bridgeCells` — its own fallback picks the least-bad option even when both corner
      // candidates are "bad" (water/obstacle), so a diagonal crossing can gain one water
      // cell the walker never saw. For a bridging road that cell is exactly as bridged as
      // its neighbours (the walker already committed to crossing here); leaving it a bare
      // water tile just strands a 1-cell gap mid-deck (an un-resolvable road-x-water claim
      // — no Bridge artifact covers a lone water tile with no bridge tile either side).
      const routedBridgeCells = new Set(result.bridgeCells);
      if (feature === 'road' && autoBridge) {
        for (const c of cells) {
          if (WATER_TYPES.has(tiles[c.y]?.[c.x]?.type ?? '')) routedBridgeCells.add(c.y * width + c.x);
        }
      }
      const bridgeCells = feature === 'road' ? [...routedBridgeCells].sort((m, n) => m - n) : [];
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

/**
 * Insert an orthogonal corner between every diagonally-adjacent pair so a path produced
 * by an 8-connected walker rasterizes to a 4-connected tile mask (NPC walkability + the
 * road-connectivity flood both step 4-neighbour). The result is a TIGHT 1-step staircase
 * — each off-axis move is a single orthogonal step — which RDP+Catmull collapse straight
 * back to the diagonal, so the smoothed centerline keeps its true angle. The corner prefers
 * a land, non-obstacle cell (the walker already forbids a diagonal whose BOTH shared
 * orthogonals are water, so a dry choice always exists) to avoid a phantom bridge/cut.
 */
function orthogonalize(
  cells: Array<{ x: number; y: number }>,
  tiles: Tile[][],
  isObstacle?: (x: number, y: number) => boolean,
): Array<{ x: number; y: number }> {
  if (cells.length < 2) return cells;
  const water = (x: number, y: number): boolean => WATER_TYPES.has(tiles[y]?.[x]?.type);
  const obstacle = (x: number, y: number): boolean => isObstacle?.(x, y) ?? false;
  const clean = (x: number, y: number): boolean => !water(x, y) && !obstacle(x, y);
  const out: Array<{ x: number; y: number }> = [cells[0]];
  for (let i = 1; i < cells.length; i++) {
    const p = cells[i - 1], c = cells[i];
    if (p.x !== c.x && p.y !== c.y) {
      const optA = { x: c.x, y: p.y };
      const optB = { x: p.x, y: c.y };
      // Preference order: clean land > water-not-obstacle > obstacle. A WATER filler on a
      // bridging road becomes one more deck cell (buildRoadGraph folds every on-path water
      // cell into `bridgeCells`), i.e. the pair stays legal via the bridge path — whereas an
      // OBSTACLE filler gets dropped by the obstacle filter, leaving the mask only corner-
      // connected (an uncosted cell the router never approved, then a diagonal gap).
      if (clean(optA.x, optA.y)) out.push(optA);
      else if (clean(optB.x, optB.y)) out.push(optB);
      else if (water(optA.x, optA.y) && !obstacle(optA.x, optA.y)) out.push(optA);
      else if (water(optB.x, optB.y) && !obstacle(optB.x, optB.y)) out.push(optB);
      else out.push(optA); // both obstacles — keep the pair; the obstacle filter + gap repair own it
    }
    out.push(c);
  }
  return out;
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
      preserveBaseType(t);
      t.type = 'bridge';
      t.walkable = true;
    } else if (WATER_TYPES.has(t.type)) {
      // Walker chose to stop at water (autoBridge=false); leave it untouched.
      continue;
    } else if (t.type === 'bridge') {
      // A later road reusing an earlier road's crossing walks over the already-stamped
      // bridge deck. The walker never flagged it (the tile reads as road, not water), so
      // stamping the plain surface here would UN-BRIDGE the crossing — a dirt ford over
      // the channel. Bridges stay bridges.
      continue;
    } else {
      preserveBaseType(t);
      t.type = roadTile;
      t.walkable = roadTile !== 'river';
    }
  }
}

/** Record the biome a road/bridge is about to overwrite, so the colour field can
 *  paint the ground *under* the road (the surface channel supplies the road albedo).
 *  Idempotent: only the FIRST overwrite — a real biome — is captured. */
function preserveBaseType(t: Tile): void {
  if (t.baseType === undefined && !ROAD_TILE_TYPES.has(t.type)) t.baseType = t.type;
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
      preserveBaseType(t);
      t.type = 'bridge';
      t.walkable = true;
    } else if (WATER_TYPES.has(t.type)) {
      continue;
    } else if (t.type === 'bridge') {
      // Same rule as applyEdge: a later write over an earlier bridge deck must not
      // downgrade it to a plain road (a dirt ford over the channel).
      continue;
    } else {
      preserveBaseType(t);
      const roadTile = tileTypeOf(w.surface);
      t.type = roadTile;
      t.walkable = roadTile !== 'river';
    }
  }
}

/**
 * Close DIAGONAL-only gaps in the finished road tile mask so the whole network is 4-connected —
 * the property `orthogonalize` guarantees WITHIN one edge, extended ACROSS road sources. An
 * inter-POI approach road, a settlement's own streets, and a gate spur are carved independently;
 * where two of them meet, their termini can land diagonally adjacent (a road anchor a tile off the
 * street it joins), leaving a corner-only touch. A 4-neighbour flood (NPC walkability + the
 * road-connectivity contract) then reads the two as DISCONNECTED even though they visually touch.
 *
 * For each diagonally-adjacent road pair with NEITHER shared orthogonal cell already a road, stamp
 * one shared orthogonal filler as `dirt_road` — preferring a walkable land cell, never water, an
 * existing bridge, or a caller-flagged obstacle (building / wall / protected green). Collect then
 * apply so the scan sees a stable mask. Returns the number of fillers stamped (normally 0–a few).
 */
export function repairRoadDiagonalGaps(
  tiles: Tile[][],
  width: number,
  height: number,
  isBlocked?: (x: number, y: number) => boolean,
): number {
  const isRoad = (x: number, y: number): boolean => ROAD_TILE_TYPES.has(tiles[y]?.[x]?.type ?? '');
  const fillable = (x: number, y: number): boolean => {
    const t = tiles[y]?.[x];
    if (!t) return false;
    if (ROAD_TILE_TYPES.has(t.type) || WATER_TYPES.has(t.type)) return false;
    return !(isBlocked?.(x, y) ?? false);
  };
  const toStamp = new Set<string>();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!isRoad(x, y)) continue;
      // Check the two forward diagonals so every diagonal pair is visited exactly once.
      for (const [dx, dy] of [[1, 1], [1, -1]] as const) {
        const ox = x + dx, oy = y + dy;
        if (!isRoad(ox, oy)) continue;
        if (isRoad(ox, y) || isRoad(x, oy)) continue;      // already 4-connected through a shared road cell
        if (fillable(ox, y)) toStamp.add(`${ox},${y}`);
        else if (fillable(x, oy)) toStamp.add(`${x},${oy}`);
      }
    }
  }
  for (const k of toStamp) {
    const ci = k.indexOf(',');
    const x = Number(k.slice(0, ci)), y = Number(k.slice(ci + 1));
    const t = tiles[y]?.[x];
    if (!t) continue;
    preserveBaseType(t);
    t.type = 'dirt_road';
    t.walkable = true;
  }
  return toStamp.size;
}

/**
 * DEGENERATE-CASE REPAIR: guarantee every seed-declared road connection is ONE 4-connected
 * road component. The inter-POI walker, settlement streets and gate spurs are carved by
 * separate passes whose interplay is seed-sensitive — a village-interior re-route (e.g. a
 * building preset changing its door face) can leave the A→B network split into two islands
 * even though every individual pass succeeded. Like the gate stitches, this runs LAST, is
 * normally a no-op, and LOGS when it has to carve: flood 4-connected road tiles from the
 * road cell nearest `from`; if the component never comes within reach of `to`, BFS a legal
 * land path (never water / bridge-less channels / caller-flagged obstacles) between the two
 * closest component cells and stamp it `dirt_road`. Returns total cells carved.
 *
 * When `graph` is passed, a fired repair ALSO records the connector as a genuine `RoadEdge`
 * (junction nodes at both component-join cells, class/surface inherited from the repaired
 * connection) so the connector flows through the NORMAL road pipeline — smoothed centerline,
 * terrain carve, analytic ribbon paint. Without it the repair stamped TILES ONLY: walkable
 * `dirt_road` cells with `baseType` set that no graph edge covered, which `packColorField`
 * painted as plain ground (the road albedo comes from the ribbon) — an INVISIBLE road NPCs
 * walked across bare grass (the audit's orphan-INVISIBLE class, 23/11 cells on the probe
 * seeds).
 */
export function repairConnectionSplits(
  tiles: Tile[][],
  width: number,
  height: number,
  connections: Connection[] | undefined,
  pois: POI[],
  isBlocked?: (x: number, y: number) => boolean,
  graph?: RoadGraph,
): number {
  if (!connections?.length) return 0;
  const isRoad = (x: number, y: number): boolean => ROAD_TILE_TYPES.has(tiles[y]?.[x]?.type ?? '');
  // A repair path may ride existing roads and cross any legal land cell. STRICT mode also
  // refuses caller-blocked cells EVEN when they carry a road tile: a settlement street can
  // legitimately thread a croft fence, but a repair EDGE riding that cell would claim a
  // road×barrier crossing no gatehouse resolves. Strict is tried first; if the components
  // genuinely cannot be joined otherwise, the permissive fallback restores connectivity
  // (the claim lint will name the residue rather than the network staying split).
  const passableIn = (strict: boolean) => (x: number, y: number): boolean => {
    const t = tiles[y]?.[x];
    if (!t) return false;
    if (strict && (isBlocked?.(x, y) ?? false)) return false;
    if (ROAD_TILE_TYPES.has(t.type)) return true;
    if (WATER_TYPES.has(t.type)) return false;
    return !(isBlocked?.(x, y) ?? false);
  };
  const nearestRoad = (cx: number, cy: number, maxR = 6): { x: number; y: number } | null => {
    for (let r = 0; r <= maxR; r++)
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          if (isRoad(cx + dx, cy + dy)) return { x: cx + dx, y: cy + dy };
        }
    return null;
  };
  const flood = (start: { x: number; y: number }): Set<number> => {
    const seen = new Set<number>();
    const queue = [start.y * width + start.x];
    while (queue.length) {
      const k = queue.pop()!;
      if (seen.has(k)) continue;
      const x = k % width, y = (k - x) / width;
      if (!isRoad(x, y)) continue;
      seen.add(k);
      if (x + 1 < width) queue.push(k + 1);
      if (x > 0) queue.push(k - 1);
      if (y + 1 < height) queue.push(k + width);
      if (y > 0) queue.push(k - width);
    }
    return seen;
  };

  const poiById = new Map(pois.map((p) => [p.id, p]));
  let totalCarved = 0;
  for (const conn of connections) {
    if (conn.type !== 'road') continue;
    const a = poiById.get(conn.from)?.position, b = poiById.get(conn.to)?.position;
    if (!a || !b) continue;
    const seedA = nearestRoad(a.x, a.y), seedB = nearestRoad(b.x, b.y);
    if (!seedA || !seedB) continue;                      // no road near a POI — not a split, a miss
    const compA = flood(seedA);
    // Connected = the A-component reaches within 3 tiles of POI b (the contract's read).
    let reached = false;
    for (let dy = -3; dy <= 3 && !reached; dy++)
      for (let dx = -3; dx <= 3 && !reached; dx++) {
        const x = b.x + dx, y = b.y + dy;
        if (x >= 0 && y >= 0 && x < width && y < height && compA.has(y * width + x)) reached = true;
      }
    if (reached) continue;
    const compB = flood(seedB);
    if (!compB.size || compB.has(seedA.y * width + seedA.x)) continue;
    // Closest pair of cells across the two components (manhattan).
    let best: { ax: number; ay: number; bx: number; by: number; d: number } | null = null;
    for (const ka of compA) {
      const ax = ka % width, ay = (ka - ax) / width;
      for (const kb of compB) {
        const bx = kb % width, by = (kb - bx) / width;
        const d = Math.abs(ax - bx) + Math.abs(ay - by);
        if (!best || d < best.d) best = { ax, ay, bx, by, d };
      }
    }
    if (!best) continue;
    // BFS shortest legal path A-cell → B-cell (4-connected over passable): strict first
    // (never through a barrier cell, even one carrying a street tile), permissive fallback.
    const startK = best.ay * width + best.ax, goalK = best.by * width + best.bx;
    const bfs = (passable: (x: number, y: number) => boolean): Map<number, number> | null => {
      const prev = new Map<number, number>();
      const q = [startK]; prev.set(startK, -1);
      for (let qi = 0; qi < q.length; qi++) {
        const k = q[qi];
        const x = k % width, y = (k - x) / width;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const nk = ny * width + nx;
          if (prev.has(nk) || !passable(nx, ny)) continue;
          prev.set(nk, k);
          if (nk === goalK) return prev;
          q.push(nk);
        }
      }
      return null;
    };
    let prev = bfs(passableIn(true));
    if (!prev) {
      prev = bfs(passableIn(false));
      if (prev) console.warn(`[worldgen] connection repair for ${conn.from}→${conn.to} fell back to the PERMISSIVE path — connector crosses caller-blocked cell(s)`);
    }
    if (!prev) {
      console.warn(`[worldgen] connection repair FAILED for ${conn.from}→${conn.to} — components split with no legal land path`);
      continue;
    }
    // Reconstruct the BFS path in A→B order — it is BOTH the tile stamp AND (with `graph`)
    // the new repair edge's polyline, so carve/ribbon/raster all agree by construction.
    const path: { x: number; y: number }[] = [];
    for (let k = goalK; k !== undefined && k !== -1; k = prev.get(k)!) path.push({ x: k % width, y: ((k - (k % width)) / width) });
    path.reverse();
    const surface = surfaceOf(conn);
    const roadTile = tileTypeOf(surface);
    let carved = 0;
    for (const c of path) {
      const t = tiles[c.y]?.[c.x];
      if (!t || ROAD_TILE_TYPES.has(t.type)) continue;
      preserveBaseType(t);
      t.type = roadTile;
      t.walkable = true;
      carved++;
    }
    if (graph && path.length >= 2) {
      // The connector becomes a REAL edge: it now gets a smoothed centerline, a corridor
      // carve and ribbon paint like any road (previously it existed only as bare tiles).
      const mkNode = (p: { x: number; y: number }, tag: string): RoadNode => {
        const node: RoadNode = { id: `rn-repair-${conn.from}-${conn.to}-${tag}`, x: p.x, y: p.y, kind: 'junction' };
        graph.nodes.push(node);
        return node;
      };
      graph.edges.push({
        id: `re-repair-${conn.from}-${conn.to}`,
        a: mkNode(path[0], 'a').id,
        b: mkNode(path[path.length - 1], 'b').id,
        polyline: path,
        feature: 'road',
        class: classForConnection(poiById.get(conn.from), poiById.get(conn.to)),
        surface,
        bridgeCells: [],   // the BFS path is land-only by construction (passable() forbids water)
      });
    }
    totalCarved += carved;
    console.warn(`[worldgen] connection repair FIRED for ${conn.from}→${conn.to} — carved ${carved} tile(s)`
      + `${graph ? ' as a real road edge' : ''}; road network was split into islands`);
  }
  return totalCarved;
}
