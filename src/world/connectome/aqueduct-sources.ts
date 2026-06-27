// src/world/connectome/aqueduct-sources.ts
//
// G6 slice 4a — the bridge from the live WATER CONNECTOME to the aqueduct placer. An aqueduct's
// intake is a HIGHLAND water source; the river network (`river-network.ts`) already names exactly
// those: `spring` nodes (headwaters where a channel is born) and `lake_outlet` nodes (a perched
// lake's spill point). This adapter lifts them into the `WaterSource` candidates `planAqueducts`
// consumes — optionally keeping only those above an absolute highland floor (the placer's per-
// settlement HEAD check does the real relative-height work; this just bounds the candidate set).
//
// Pure + deterministic — reads the network's already-ordered nodes, derives ids from theirs.

import type { WaterNetwork, WaterNodeKind } from '@/terrain/river-network';
import type { WaterSource } from './aqueduct-placement';

export interface HighlandSourceOptions {
  /** Normalised [0,1] ground elevation at a tile. Required (to apply the highland floor / report). */
  elevAt: (x: number, y: number) => number;
  /** Metres of relief per normalised elevation unit. Required. */
  reliefM: number;
  /** Keep only sources at least this high (metres). Default 0 — keep all; the placer's head check
   *  then decides which actually sit above each settlement. */
  minElevM?: number;
  /** Which water-node kinds count as intakes. Default `['spring', 'lake_outlet']`. */
  includeKinds?: WaterNodeKind[];
}

/**
 * Extract the candidate highland aqueduct intakes from a water network: its springs and lake
 * outlets (by default), as `WaterSource`s the placer can route from. Deterministic; ids are
 * `aqsrc:<nodeId>`. Pass `minElevM` to drop low-lying springs before routing.
 */
export function findHighlandSources(net: WaterNetwork, opts: HighlandSourceOptions): WaterSource[] {
  const kinds = new Set<WaterNodeKind>(opts.includeKinds ?? ['spring', 'lake_outlet']);
  const minElevM = opts.minElevM ?? 0;
  const out: WaterSource[] = [];
  for (const node of net.nodes) {
    if (!kinds.has(node.kind)) continue;
    if (opts.elevAt(node.x, node.y) * opts.reliefM < minElevM) continue;
    out.push({ id: `aqsrc:${node.id}`, x: node.x, y: node.y });
  }
  return out;
}
