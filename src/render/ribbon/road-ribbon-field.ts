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

/** A maximal run of polyline points, flagged land (road) or bridge (deck). */
interface PolyRun { bridge: boolean; pts: { x: number; y: number }[] }

/**
 * Split a road polyline at its bridge-cell runs. Land runs become ROAD (the ribbon stops at
 * the bank); bridge runs become a separate DECK that spans the gap — so the road genuinely
 * terminates at each side of the crossing (the ford) instead of carrying across. Each bridge
 * run is padded by its flanking approach points so the deck meets the banks.
 */
function splitAtBridges(pts: { x: number; y: number }[], onBridge: boolean[]): PolyRun[] {
  const runs: PolyRun[] = [];
  let i = 0;
  while (i < pts.length) {
    const bridge = onBridge[i];
    const s = i;
    while (i < pts.length && onBridge[i] === bridge) i++;
    const e = i - 1;
    if (bridge) {
      // Pad the deck with one approach point each side so it lands on the banks.
      const a = Math.max(0, s - 1), b = Math.min(pts.length - 1, e + 1);
      runs.push({ bridge: true, pts: pts.slice(a, b + 1) });
    } else {
      runs.push({ bridge: false, pts: pts.slice(s, e + 1) });
    }
  }
  return runs;
}

/** Pure: road graph → swept ribbon mesh (tile space; lifted on the GPU). When `map` is given,
 *  a road that meets water TERMINATES at the bank (its land segments sweep as road) and each
 *  water crossing becomes a SEPARATE level DECK span (tag.y = BRIDGE_TAG, deck elevation in
 *  `speed`) — the road no longer carries across the river. */
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
      const onBridge = edge.polyline.map((p) => decks.has(idxOf(p.x, p.y)));
      for (const run of splitAtBridges(edge.polyline, onBridge)) {
        if (run.pts.length < 2) continue;
        if (run.bridge) {
          // Deck span: force-keep every point (no RDP collapse), lift to the level deck
          // elevation (approach terrain at the ends, deck level over the water).
          specs.push({
            points: run.pts,
            halfWidth: hw,
            keepMask: run.pts.map(() => true),
            tag: [tier, BRIDGE_TAG],
            speed: (x, y): number => decks.get(idxOf(x, y)) ?? (hf![idxOf(x, y)] ?? 0),
          });
        } else {
          specs.push({ points: run.pts, halfWidth: hw, tag: [tier, 0] });
        }
      }
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
