// src/world/water-network-store.ts
//
// The world's WATER CONNECTOME (nodes + reaches), memoised per (seed, dims) — the
// same derive-don't-persist contract as getHydrologyResult / getRiverDeformationStore.
// It's a pure VIEW of the hydrology raster, so it re-derives identically on load and
// never travels in the save.
import type { GameMap } from '@/core/types';
import { buildWaterNetwork, type WaterNetwork } from '@/terrain/river-network';
import { styledRiverFlowThreshold } from '@/terrain/hydrology';
import { getHydrologyResult } from '@/world/hydrology-store';
import { waterNetworkToConnectome } from '@/world/connectome/water-nodes';
import type { WorldNode } from '@/world/connectome/world-node';

const cache = new Map<string, WaterNetwork>();
const connectomeCache = new Map<string, WorldNode>();
const CACHE_CAP = 4;

function key(map: GameMap): string {
  return `${map.seed}:${map.width}x${map.height}`;
}

/** The world's water connectome — memoised. Deterministic from the hydrology raster. */
export function getWaterNetwork(map: GameMap): WaterNetwork {
  const k = key(map);
  const hit = cache.get(k);
  if (hit) return hit;
  // SAME styled threshold as the raster/carve — a fixed threshold here built a render
  // network whose reaches (and their width/depth classes) disagreed with the tiles.
  const net = buildWaterNetwork(
    getHydrologyResult(map), map.width, map.height,
    styledRiverFlowThreshold(map.worldSeed, map.width, map.height));
  cache.set(k, net);
  if (cache.size > CACHE_CAP) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return net;
}

/**
 * The world's water sub-connectome (`water_system` WorldNode) — the river network lifted
 * into the unified connectome vocabulary, memoised. Fate / agents / crossings read THIS to
 * address rivers as nodes. Derived from the same hydrology raster, so it re-derives on load.
 */
export function getWaterConnectome(map: GameMap): WorldNode {
  const k = key(map);
  const hit = connectomeCache.get(k);
  if (hit) return hit;
  const root = waterNetworkToConnectome(getWaterNetwork(map), { rootId: `water_system:${k}` });
  connectomeCache.set(k, root);
  if (connectomeCache.size > CACHE_CAP) {
    const oldest = connectomeCache.keys().next().value;
    if (oldest !== undefined) connectomeCache.delete(oldest);
  }
  return root;
}

/** Drop the memoised networks (tests; harmless in prod). */
export function clearWaterNetworkCache(): void {
  cache.clear();
  connectomeCache.clear();
}
