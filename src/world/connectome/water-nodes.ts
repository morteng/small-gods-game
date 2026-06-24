// src/world/connectome/water-nodes.ts
//
// WATER → the unified world connectome. The water network (`river-network.ts`) is a
// queryable graph of its own; this lifts it into the SAME `WorldNode` vocabulary the
// rest of the world is built from, so Fate / agents / crossings see rivers as first-
// class nodes — "the river that leaves Mirror Pond", "the confluence above the mill" —
// and can address, tag, and re-link them like any other place.
//
// Mapping (mirrors how crossings are a parallel connectome layer derived from the map):
//   • a `water_system` ROOT `contains` every junction and reach node.
//   • each WATER NODE (spring / confluence / lake_outlet / lake_inlet / river_mouth)
//     becomes a leaf `WorldNode` with an `anchor` at its cell.
//   • each REACH becomes a `WorldNode` of kind `reach` carrying its spectrum class,
//     order, flow and lake-fed flag as params, anchored at its midpoint, with a
//     `connects` edge to each of its two endpoint junctions (upstream + downstream).
//
// Ids are REUSED from the water network (`wn:<cell>`, `wr:<from>-<to>`) so a crossing
// can `spans→ wr:…` the very reach it bridges. A caller-supplied `tagsAt` resolver
// stamps feature tags (biome, "near settlement", …) onto each node — the "tags for
// other features" hook that makes water a *participating* part of the world graph,
// not an island. Pure: no rendering, no randomness, no I/O.

import type { WaterNetwork, WaterNode, WaterReach, WaterNodeKind, WaterBody } from '@/terrain/river-network';
import { node, type WorldNode, type WorldNodeParams, type Relation } from './world-node';
import type { PressureItem, PressurePair } from './pressure';

/** Junction kind → the connectome `kind` string. Keeps water kinds namespaced & legible. */
const JUNCTION_KIND: Record<WaterNodeKind, string> = {
  spring: 'spring',
  lake_outlet: 'lake_outlet',
  confluence: 'confluence',
  lake_inlet: 'lake_inlet',
  mouth: 'river_mouth',
};

export interface WaterConnectomeOptions {
  /** Root node id (so multiple systems / a re-derive can be distinguished). */
  rootId?: string;
  /** Feature tags at a tile — biome, "near settlement", etc. Stamped onto each node's
   *  `params.tags`. The integration seam: water participates in the world graph. */
  tagsAt?: (x: number, y: number) => string[];
  /** Cascading site params for the whole system (era/biome/style/…) — flow to children. */
  params?: WorldNodeParams;
}

function withTags(base: WorldNodeParams, x: number, y: number, tagsAt?: (x: number, y: number) => string[]): WorldNodeParams {
  const tags = tagsAt?.(x, y);
  return tags && tags.length ? { ...base, tags } : base;
}

/** One junction (spring / confluence / …) → a leaf `WorldNode` anchored at its cell. */
function junctionNode(n: WaterNode, opts: WaterConnectomeOptions): WorldNode {
  return node(n.id, JUNCTION_KIND[n.kind], {
    anchor: { x: n.x, y: n.y },
    params: withTags({ water: true }, n.x, n.y, opts.tagsAt),
  });
}

/** One lake body → a `WorldNode` (kind `lake`) at its centroid. It `serves` the channel
 *  junctions on its shore: a lake-fed river is born at the lake (outlet), an inflowing
 *  stream ends in it (inlet). The lake is the source/sink the channels hang off. */
function lakeNode(l: WaterBody, opts: WaterConnectomeOptions): WorldNode {
  const relations: Relation[] = [
    ...l.outletIds.map((to): Relation => ({ kind: 'serves', to })),
    ...l.inletIds.map((to): Relation => ({ kind: 'connects', to })),
  ];
  return node(l.id, 'lake', {
    anchor: { x: l.x, y: l.y },
    params: withTags({ water: true, klass: l.klass, area: l.area }, Math.round(l.x), Math.round(l.y), opts.tagsAt),
    relations,
  });
}

/** One reach → a `WorldNode` (kind `reach`) carrying its class/flow, `connects` to both ends. */
function reachNode(r: WaterReach, opts: WaterConnectomeOptions): WorldNode {
  const mid = r.centerline[Math.floor(r.centerline.length / 2)] ?? r.centerline[0];
  const mx = mid.x - 0.5, my = mid.y - 0.5; // centreline is cell-centre coords; anchor in cell space
  return node(r.id, 'reach', {
    anchor: { x: mx, y: my },
    params: withTags(
      { water: true, klass: r.klass, order: r.order, flow: Math.round(r.flow), lakeFed: r.lakeFed },
      mx, my, opts.tagsAt,
    ),
    relations: [
      { kind: 'connects', to: r.from },
      { kind: 'connects', to: r.to },
    ],
  });
}

/**
 * Lift a water network into a `water_system` sub-connectome: a root node that `contains`
 * every junction and reach, reaches `connects`-linked to their endpoints. Deterministic —
 * nodes/reaches are emitted in the network's own (index-derived) order. Pure.
 */
/**
 * Clearance discs for the water network's features — what `computePressure` reads to flag
 * crowding. A junction wants a small fixed clearance; a lake wants room scaled to its own
 * extent (the radius of an equal-area disc) plus a margin. Positions are cell-centres (so
 * they line up with the overlay's projection of `x+0.5`).
 */
export function waterPressureItems(net: WaterNetwork, junctionClearance = 1.5, lakeMargin = 1): PressureItem[] {
  const items: PressureItem[] = [];
  for (const n of net.nodes) items.push({ id: n.id, x: n.x + 0.5, y: n.y + 0.5, radius: junctionClearance });
  for (const l of net.lakes) {
    items.push({ id: l.id, x: l.x + 0.5, y: l.y + 0.5, radius: Math.sqrt(l.area / Math.PI) + lakeMargin });
  }
  return items;
}

/** How a pinch point between two water features wants to resolve. */
export type WaterResolution = 'merge' | 'separate';
export interface ResolvedPressurePair extends PressurePair {
  resolution: WaterResolution;
  reason: string;
}

const SOURCEISH = new Set(['spring', 'lake_outlet']);
function featureKind(net: WaterNetwork, id: string): string {
  const n = net.byId.get(id);
  if (n) return n.kind;
  return net.lakes.some((l) => l.id === id) ? 'lake' : 'unknown';
}

/**
 * Annotate impinging pairs with a SUGGESTED resolution — the key idea that pressure isn't
 * only "push apart". A channel meeting a lake, or two headwaters on top of each other, want
 * to JOIN (one feeds/becomes the other); unrelated features want to separate. Advisory: the
 * author (human or agent) still decides, and may leave a deliberate squish.
 */
export function suggestWaterResolutions(net: WaterNetwork, pairs: readonly PressurePair[]): ResolvedPressurePair[] {
  return pairs.map((p) => {
    const a = featureKind(net, p.a), b = featureKind(net, p.b);
    const kinds = [a, b];
    let resolution: WaterResolution = 'separate';
    let reason = 'unrelated features — separate, or leave squished if intended';
    if (kinds.includes('lake') && kinds.some((k) => k !== 'lake')) {
      resolution = 'merge'; reason = 'channel meets a lake — join (the lake feeds the channel)';
    } else if (a === 'lake' && b === 'lake') {
      resolution = 'merge'; reason = 'two basins touch — merge into one lake';
    } else if (SOURCEISH.has(a) && SOURCEISH.has(b)) {
      resolution = 'merge'; reason = 'two headwaters coincide — join into one source';
    }
    return { ...p, resolution, reason };
  });
}

export function waterNetworkToConnectome(net: WaterNetwork, opts: WaterConnectomeOptions = {}): WorldNode {
  const children: WorldNode[] = [
    ...net.lakes.map((l) => lakeNode(l, opts)),
    ...net.nodes.map((n) => junctionNode(n, opts)),
    ...net.reaches.map((r) => reachNode(r, opts)),
  ];
  return node(opts.rootId ?? 'water_system', 'water_system', {
    params: opts.params ?? {},
    children,
  });
}
