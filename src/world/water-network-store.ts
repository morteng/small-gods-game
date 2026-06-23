// src/world/water-network-store.ts
//
// The world's WATER CONNECTOME (nodes + reaches), memoised per (seed, dims) — the
// same derive-don't-persist contract as getHydrologyResult / getRiverDeformationStore.
// It's a pure VIEW of the hydrology raster, so it re-derives identically on load and
// never travels in the save.
import type { GameMap } from '@/core/types';
import { buildWaterNetwork, type WaterNetwork } from '@/terrain/river-network';
import { DEFAULT_RIVER_FLOW_THRESHOLD } from '@/terrain/hydrology';
import { getHydrologyResult } from '@/world/hydrology-store';

const cache = new Map<string, WaterNetwork>();
const CACHE_CAP = 4;

function key(map: GameMap): string {
  return `${map.seed}:${map.width}x${map.height}`;
}

/** The world's water connectome — memoised. Deterministic from the hydrology raster. */
export function getWaterNetwork(map: GameMap): WaterNetwork {
  const k = key(map);
  const hit = cache.get(k);
  if (hit) return hit;
  const net = buildWaterNetwork(getHydrologyResult(map), map.width, map.height, DEFAULT_RIVER_FLOW_THRESHOLD);
  cache.set(k, net);
  if (cache.size > CACHE_CAP) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return net;
}

/** Drop the memoised networks (tests; harmless in prod). */
export function clearWaterNetworkCache(): void {
  cache.clear();
}
