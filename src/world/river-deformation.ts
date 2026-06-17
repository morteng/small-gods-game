// src/world/river-deformation.ts
//
// Rivers → terrain CARVE — the "wide water = carve + fill" half of the water epic
// (design doc §1). The second producer (after road grade-cut) to feed the shared
// deformation channel. A river cell's drainage direction (`drainTo`, from the
// hydrology model) gives a unit segment along the flow; we drop a `carve`
// `polylineDeformation` along it, deepening the channel with Strahler order so a
// trunk river cuts a real valley and a headwater a shallow gully.
//
// The carve LOWERS the bed; the water surface (S2) fills back to the original
// ground level, so the carve depth IS the river's depth. Determinism & save-safety
// match road-deformation: derived from the (persisted) seed + hydrology model,
// nothing stored, re-derives identically on load.
import type { GameMap, HydrologyResult } from '@/core/types';
import { WaterType } from '@/core/types';
import { DeformationStore, polylineDeformation, type Deformation } from '@/world/terrain-deformation';
import { getHydrologyResult } from '@/world/hydrology-store';

/** Channel carve depth (metres) by Strahler order: a headwater is shallow, a trunk deep. */
const RIVER_CARVE_BASE_M = 0.6;
const RIVER_CARVE_PER_ORDER_M = 0.5;
const RIVER_CARVE_MAX_M = 3.0;
/** Shoulder taper beyond the channel half-width, in tiles (no cliff at the bank). */
const BANK_FEATHER_TILES = 1.0;

function carveDepthM(strahler: number): number {
  return Math.min(RIVER_CARVE_BASE_M + RIVER_CARVE_PER_ORDER_M * Math.max(0, strahler - 1), RIVER_CARVE_MAX_M);
}

/**
 * Pure: the hydrology model → the channel-carve deformations its river cells imply.
 * One short 'carve' brush per river cell, along its flow direction toward `drainTo`.
 * Half-width comes from the cell's derived channel `width` (in tiles), depth from
 * its Strahler order. Cells are visited in index order for determinism.
 */
export function buildRiverDeformations(map: GameMap, hydro: HydrologyResult): Deformation[] {
  const { width: w, height: h } = map;
  const { waterType, drainTo, strahler, width: chWidth } = hydro;
  const out: Deformation[] = [];
  for (let i = 0; i < waterType.length; i++) {
    if (waterType[i] !== WaterType.River) continue;
    const ax = i % w, ay = (i / w) | 0;
    const t = drainTo[i];
    // Segment toward the downstream neighbour; outlet cells carve a unit point.
    const bx = t >= 0 ? t % w : ax;
    const by = t >= 0 ? (t / w) | 0 : ay;
    const halfWidth = Math.max(0.4, chWidth[i] / 2);
    out.push(
      polylineDeformation({
        id: `river:${i}`,
        source: 'river:incision',
        points: bx === ax && by === ay ? [{ x: ax, y: ay }] : [{ x: ax, y: ay }, { x: bx, y: by }],
        halfWidth,
        feather: BANK_FEATHER_TILES,
        amount: carveDepthM(strahler[i]),
        op: 'carve',
      }),
    );
  }
  // Guard against an unused-import / unused-param lint when h is otherwise unread.
  void h;
  return out;
}

// ── Memoised river store, keyed like getRoadDeformationStore ──
const storeCache = new Map<string, DeformationStore>();
const CACHE_CAP = 4;

function key(map: GameMap): string {
  return `${map.seed}:${map.width}x${map.height}`;
}

/** The river-incision deformation store for a world — memoised. Empty when dry. */
export function getRiverDeformationStore(map: GameMap): DeformationStore {
  const k = key(map);
  let store = storeCache.get(k);
  if (store) return store;
  store = new DeformationStore();
  store.add(...buildRiverDeformations(map, getHydrologyResult(map)));
  storeCache.set(k, store);
  if (storeCache.size > CACHE_CAP) {
    const oldest = storeCache.keys().next().value;
    if (oldest !== undefined) storeCache.delete(oldest);
  }
  return store;
}

/** Drop the memoised river stores (tests; harmless in prod). */
export function clearRiverDeformationCache(): void {
  storeCache.clear();
}
