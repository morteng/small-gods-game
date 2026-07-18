// src/world/connectome/crossing-openings.ts
//
// THE crossing opening, shared. A river crossing has exactly one truth about "where does the road
// cross the water": two bank CELLS and the axis between them. Before this module every consumer
// re-derived it, and they disagreed —
//   * the deck was sited from the RAW walker polyline (`detectCrossings` banks), while
//   * the ribbon the player sees is the SMOOTHED centreline (`smoothCenterline`), which at a bend
//     corner-cuts a tile sideways off it,
// so the bridge sat beside the road, its yaw came from the chord of two independently-snapped
// raster points (a diagonal deck under a perpendicular road), and the ribbon painted cobble
// across the open channel the deck had vacated.
//
// This is the crossing analogue of `gateOpeningCell` (barrier.ts): ONE integer opening, derived
// ONCE, read by the deck siting, the ribbon pin (`pinBankOpenings`, road-deformation.ts), the
// raster reconciliation and the `bridge.seating` lint. Memoised on the road graph object, exactly
// like `gateProfileCache` — the openings are a pure function of (roadGraph, render water).

import type { GameMap } from '@/core/types';
import { getRenderWaterMask } from '@/world/render-water';
import { detectCrossings } from './detect-crossings';

/** One crossing's opening — the two bank cells the deck seats on AND the road threads. */
export interface CrossingOpening {
  /** The crossing spec id (`crossing@<edgeId>#<n>`). */
  id: string;
  /** The road edge this crossing sits on. */
  edgeId: string;
  /** The two integer bank cells, in the edge's polyline order. */
  a: [number, number];
  b: [number, number];
  /** Unit direction of the threaded road across the crossing (a → b) — the deck's yaw. */
  axis: [number, number];
}

// Memo keyed on the graph OBJECT + its `rev`: the graph used to be immutable post-gen, but the
// road-wear economy now mutates it in place (S2 class/surface flips bump rev; S4 adoption adds
// edges), so a bare object key would serve stale openings after an adoption adds a crossing.
const cache = new WeakMap<object, { rev: number; out: CrossingOpening[] }>();

/** The edge id a crossing spec belongs to (`crossing@<edgeId>#<n>`). Exported so the deck siter
 *  reads the crossing's road from the SAME parse — a bridge's running surface must be the surface
 *  of the road it carries, and that road is named in the spec id. */
export function edgeIdOf(specId: string): string {
  const at = specId.indexOf('@');
  const hash = specId.lastIndexOf('#');
  return at >= 0 && hash > at ? specId.slice(at + 1, hash) : '';
}

/**
 * The shared crossing openings of a map — memoised per road-graph object. Empty when the map has
 * no road graph, or when no road actually crosses visible water (then nothing needs an opening).
 */
export function getCrossingOpenings(map: GameMap): CrossingOpening[] {
  const graph = map.roadGraph;
  if (!graph || !graph.edges.length || !map.tiles?.length) return [];
  const rev = graph.rev ?? 0;
  const hit = cache.get(graph);
  if (hit && hit.rev === rev) return hit.out;

  const wet = getRenderWaterMask(map);
  const out: CrossingOpening[] = [];
  for (const spec of detectCrossings(graph, map.width, { isWater: wet, bridgeAt: wet })) {
    if (!spec.bankCells || !spec.axis) continue;   // no ribbon-seated opening (ribbon missed the channel)
    out.push({ id: spec.id, edgeId: edgeIdOf(spec.id), a: spec.bankCells[0], b: spec.bankCells[1], axis: spec.axis });
  }
  cache.set(graph, { rev, out });
  return out;
}

/** The shared openings on ONE road edge. */
export function crossingOpeningsForEdge(map: GameMap, edgeId: string): CrossingOpening[] {
  const all = getCrossingOpenings(map);
  return all.length === 0 ? all : all.filter((o) => o.edgeId === edgeId);
}

/**
 * The cells the DECK carries the road over: every cell on the straight deck line between (and
 * including) a crossing's two bank cells. These are the cells where the ribbon may legally stand
 * on water — the deck IS the running surface there — so the raster reconciliation stamps them
 * `bridge` instead of rejecting the fillet, and the pavedness pass leaves them to the deck sprite.
 */
export function deckLineCells(op: CrossingOpening): Array<[number, number]> {
  const [ax, ay] = op.a, [bx, by] = op.b;
  const dx = bx - ax, dy = by - ay;
  const len = Math.hypot(dx, dy);
  const out: Array<[number, number]> = [];
  const seen = new Set<string>();
  const push = (cx: number, cy: number): void => {
    const k = `${cx},${cy}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push([cx, cy]);
  };
  // Sample FINELY (sub-cell), not once per major-axis step: the pinned ribbon resamples the deck
  // run at its own spacing, so a coarse Bresenham walk would miss cells the drawn road actually
  // rounds onto — and a missed cell is a cell the reconciliation calls illegal water, which
  // rejects the fillet and snaps the road right back off the bridge. This must be a SUPERSET.
  const steps = Math.max(1, Math.ceil(len / 0.2));
  let px = Math.round(ax), py = Math.round(ay);
  push(px, py);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const cx = Math.round(ax + dx * t), cy = Math.round(ay + dy * t);
    if (cx === px && cy === py) continue;
    // Keep the run 4-CONNECTED (the walkability + road-connectivity yardstick): a diagonal step
    // gets its orthogonal corner, so NPCs can actually walk the deck the ribbon draws.
    if (cx !== px && cy !== py) push(cx, py);
    push(cx, cy);
    px = cx; py = cy;
  }
  return out;
}

/** Every deck cell of every crossing on a map, as a `"x,y"` key set — the "a road may stand on
 *  water HERE" allowance the raster reconciliation and the ribbon-legal lint share. */
export function deckCellKeys(map: GameMap): Set<string> {
  const out = new Set<string>();
  for (const op of getCrossingOpenings(map)) {
    for (const [x, y] of deckLineCells(op)) out.add(`${x},${y}`);
  }
  return out;
}
