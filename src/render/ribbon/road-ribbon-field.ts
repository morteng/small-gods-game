// src/render/ribbon/road-ribbon-field.ts
//
// Build the ROAD ribbon mesh (roads-epic T7) from the world road graph — the GPU
// replacement for the CPU `poly` overlay (`iso-road-ribbon.ts`). Each road edge's
// walked polyline is swept into a terrain-following ribbon by `ribbon-geometry`;
// the GPU ribbon pass lifts + iso-projects it. Surface (dirt/stone) is baked into
// the per-vertex tag so one draw call shades a mixed road network. Pure +
// memoised per road-graph identity (the graph is immutable at runtime).

import { buildRibbonMesh, type RibbonSpec, type RibbonMesh } from './ribbon-geometry';
import type { RoadGraph, RoadClass, RoadSurface } from '@/world/road-graph';

/**
 * Road TIER (0..3) — the visual register the ribbon fragment shader switches on
 * (path · rutted track · packed road · cobbled-with-curb). Today it's derived
 * from the edge's class + surface; the deeper model (tier from settlement
 * prosperity / traffic / upkeep, "roads vary like buildings") feeds this same
 * channel once the road graph carries those attributes.
 */
export function roadTier(edge: { class: RoadClass; surface: RoadSurface }): number {
  if (edge.surface === 'stone') return 3;            // cobbled, curbed
  if (edge.class === 'path') return 0;               // foot path
  if (edge.class === 'track') return 1;              // cart track + median
  return 2;                                          // packed dirt road / highway
}

/** Ribbon half-width in TILES by tier — wealthier/busier roads are wider. */
const TIER_HALF_WIDTH = [0.22, 0.34, 0.5, 0.6];

const EMPTY: RibbonMesh = { data: new Float32Array(0), vertexCount: 0 };

/** Pure: road graph → swept ribbon mesh (tile space; lifted on the GPU). */
export function buildRoadRibbonMesh(graph: RoadGraph | undefined): RibbonMesh {
  if (!graph?.edges.length) return EMPTY;
  const specs: RibbonSpec[] = [];
  for (const edge of graph.edges) {
    if (edge.feature !== 'road') continue;
    if (edge.polyline.length < 2) continue;
    const tier = roadTier(edge);
    const hw = TIER_HALF_WIDTH[tier] ?? TIER_HALF_WIDTH[2];
    specs.push({ points: edge.polyline, halfWidth: hw, tag: [tier, 0] });
  }
  return buildRibbonMesh(specs);
}

// Memoise by graph identity — the road graph is built once per world.
let memo: { graph: RoadGraph | undefined; mesh: RibbonMesh } | null = null;
export function buildRoadRibbonMeshMemo(graph: RoadGraph | undefined): RibbonMesh {
  if (memo && memo.graph === graph) return memo.mesh;
  const mesh = buildRoadRibbonMesh(graph);
  memo = { graph, mesh };
  return mesh;
}
