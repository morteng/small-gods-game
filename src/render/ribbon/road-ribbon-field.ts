// src/render/ribbon/road-ribbon-field.ts
//
// Build the ROAD ribbon mesh (roads-epic T7) from the world road graph — the GPU
// replacement for the CPU `poly` overlay (`iso-road-ribbon.ts`). Each road edge's
// walked polyline is swept into a terrain-following ribbon by `ribbon-geometry`;
// the GPU ribbon pass lifts + iso-projects it. Surface (dirt/stone) is baked into
// the per-vertex tag so one draw call shades a mixed road network. Pure +
// memoised per road-graph identity (the graph is immutable at runtime).

import { buildRibbonMesh, type RibbonSpec, type RibbonMesh } from './ribbon-geometry';
import type { RoadGraph, RoadClass, RoadSurface, RoadEdge } from '@/world/road-graph';
import type { GameMap } from '@/core/types';
import { heightField } from '@/render/gpu/terrain-field';

/** Encoded in tag.y for ROAD vertices: 0 = normal road, BRIDGE_TAG = bridge deck.
 *  Stays < 0.5 so the shader's `tag.y > 0.5 → river` test is unaffected. */
export const BRIDGE_TAG = 0.25;

/** Deck clearance above the lerped bank line, in normalised elevation (~0.7 m at the
 *  default relief) — lifts the plank deck a touch proud of the approaches. */
const DECK_CLEARANCE = 0.012;

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

/**
 * Deck elevation per BRIDGE cell for one edge: a road that bridges water carves NO
 * channel, so its terrain height at those cells is the riverbed (below water) — left
 * alone the ribbon would dip into the river. Instead, for each maximal run of bridge
 * cells we span a level/gently-sloped DECK between the two land approaches (the road
 * heights just off either bank, read from the curved render heightfield), so the deck
 * clears the water. Keyed by grid index; only bridge cells appear. Pure.
 */
function deckElevByCell(edge: RoadEdge, map: GameMap, hf: Float32Array): Map<number, number> {
  const out = new Map<number, number>();
  if (!edge.bridgeCells.length) return out;
  const W = map.width, H = map.height;
  const pts = edge.polyline;
  const idxOf = (p: { x: number; y: number }) =>
    Math.min(H - 1, Math.max(0, Math.floor(p.y))) * W + Math.min(W - 1, Math.max(0, Math.floor(p.x)));
  const bridge = new Set(edge.bridgeCells);
  const onBridge = pts.map((p) => bridge.has(idxOf(p)));

  let i = 0;
  while (i < pts.length) {
    if (!onBridge[i]) { i++; continue; }
    const s = i;
    while (i < pts.length && onBridge[i]) i++;
    const e = i - 1;                                   // bridge run = polyline points [s..e]
    const hLo = hf[idxOf(pts[Math.max(0, s - 1)])];    // road height just before the span
    const hHi = hf[idxOf(pts[Math.min(pts.length - 1, e + 1)])]; // …and just after
    const n = e - s + 2;                               // segments across the span
    for (let k = s; k <= e; k++) {
      const t = (k - s + 1) / n;                       // 0<…<1 across the deck
      out.set(idxOf(pts[k]), hLo + (hHi - hLo) * t + DECK_CLEARANCE);
    }
  }
  return out;
}

/** Pure: road graph → swept ribbon mesh (tile space; lifted on the GPU). When `map`
 *  is given, road edges that bridge water get a raised plank DECK (tag.y = BRIDGE_TAG,
 *  deck elevation baked into the `speed` channel for the vertex shader to lift to). */
export function buildRoadRibbonMesh(graph: RoadGraph | undefined, map?: GameMap): RibbonMesh {
  if (!graph?.edges.length) return EMPTY;
  const hf = map ? heightField(map) : null;
  const specs: RibbonSpec[] = [];
  for (const edge of graph.edges) {
    if (edge.feature !== 'road') continue;
    if (edge.polyline.length < 2) continue;
    const tier = roadTier(edge);
    const hw = TIER_HALF_WIDTH[tier] ?? TIER_HALF_WIDTH[2];

    const decks = map && hf && edge.bridgeCells.length ? deckElevByCell(edge, map, hf) : null;
    if (decks && decks.size) {
      const W = map!.width, H = map!.height;
      const idxOf = (x: number, y: number) =>
        Math.min(H - 1, Math.max(0, Math.floor(y))) * W + Math.min(W - 1, Math.max(0, Math.floor(x)));
      // Force-keep the bridge cells through RDP so the deck span is densely resampled
      // (else a straight crossing collapses to a chord and gets no planks / deck lift).
      const keepMask = edge.polyline.map((p) => decks.has(idxOf(p.x, p.y)));
      specs.push({
        points: edge.polyline,
        halfWidth: hw,
        keepMask,
        // tag.y flags bridge spans; `speed` carries the deck elevation the VS lifts to.
        tag: (x, y): [number, number] => [tier, decks.has(idxOf(x, y)) ? BRIDGE_TAG : 0],
        speed: (x, y): number => decks.get(idxOf(x, y)) ?? 0,
      });
    } else {
      specs.push({ points: edge.polyline, halfWidth: hw, tag: [tier, 0] });
    }
  }
  return buildRibbonMesh(specs);
}

// Memoise by (graph, map) identity — both are built once per world.
let memo: { graph: RoadGraph | undefined; map: GameMap | undefined; mesh: RibbonMesh } | null = null;
export function buildRoadRibbonMeshMemo(graph: RoadGraph | undefined, map?: GameMap): RibbonMesh {
  if (memo && memo.graph === graph && memo.map === map) return memo.mesh;
  const mesh = buildRoadRibbonMesh(graph, map);
  memo = { graph, map, mesh };
  return mesh;
}
