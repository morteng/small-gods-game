// src/world/river-deformation.ts
//
// Rivers → terrain CARVE — the "wide water = carve + fill" half of the water epic
// (design doc §1). The second producer (after road grade-cut) to feed the shared
// deformation channel.
//
// THE CARVE FOLLOWS THE WATER CONNECTOME, not the raster. We no longer drop one
// axis-aligned unit brush per river cell (which staircased a diagonal river into a
// flight of horizontal+vertical steps); instead we walk each REACH of the water
// network (`river-network.ts`) and carve along its SMOOTHED sub-cell centreline. The
// channel's identity — a brook vs a major trunk — comes from the reach's spectrum
// CLASS, so depth and width are coherent along the whole run and a lake-fed river is
// carved as one continuous valley from its outlet to the sea. This is also the seam
// the studio's drag-to-move needs: move a node → re-walk the reach → re-carve.
//
// The carve LOWERS the bed; the water surface (S2) fills back to the original ground
// level, so the carve depth IS the river's depth. Determinism & save-safety match
// road-deformation: derived from the (persisted) seed + hydrology model, nothing
// stored, re-derives identically on load.
import type { GameMap, HydrologyResult } from '@/core/types';
import { DeformationStore, polylineDeformation, type Deformation } from '@/world/terrain-deformation';
import { getHydrologyResult } from '@/world/hydrology-store';
import { DEFAULT_RIVER_FLOW_THRESHOLD } from '@/terrain/hydrology';
import {
  buildWaterNetwork, referenceFlow, reachHalfWidths, reachDepths,
  type ReachClass, type Pt, type WaterNetwork,
} from '@/terrain/river-network';

/** Channel carve profile by spectrum CLASS — depth (metres) + channel half-width
 *  (tiles). The river reads as a real incision against the world relief (~39 m
 *  sea-to-peak): a brook cuts a ~1 m gully, a major trunk a ~6 m gorge. The
 *  render-space water surface (river-surface-field) fills the channel back to a
 *  bank-referenced line, so a deeper carve deepens the *valley*, not the apparent
 *  water depth. */
export const REACH_CARVE: Record<ReachClass, { depthM: number; halfWidth: number }> = {
  brook: { depthM: 1.0, halfWidth: 0.5 },
  stream: { depthM: 2.4, halfWidth: 0.9 },
  river: { depthM: 4.5, halfWidth: 1.4 },
  major_river: { depthM: 6.5, halfWidth: 2.2 },
};
/** Valley-wall width beyond the channel half-width, in tiles, scaled to the carve
 *  depth so the ground GRADES down into the channel (a V/U valley) rather than
 *  dropping a one-tile cliff. Kept relatively STEEP: a broad gentle feather makes the
 *  water sheet across the whole valley and read wide + staircased on flats, so the
 *  wall is just enough to avoid a one-tile cliff while still containing the channel.
 *  A 1 m gully gets a ~1-tile shoulder, a 6.5 m gorge a ~3-tile sloping wall. */
const BANK_FEATHER_MIN_TILES = 1.0;
const BANK_FEATHER_MAX_TILES = 3.0;
const BANK_FEATHER_PER_M = 0.5;

/** Max centreline vertices per carve brush. A long trunk reach is split into bounded
 *  chunks (sharing a boundary vertex, so no gap) — this keeps each brush's AABB tight
 *  so the per-tile polyline scan stays cheap, instead of one map-spanning brush whose
 *  bounding box covers (and re-scans) half the world. */
const CHUNK_VERTS = 8;

/** Valley-wall taper width (tiles) for a given carve depth — deeper ⇒ broader slope. */
function bankFeatherTiles(depthM: number): number {
  return Math.min(BANK_FEATHER_MAX_TILES, Math.max(BANK_FEATHER_MIN_TILES, depthM * BANK_FEATHER_PER_M));
}

/** Split a polyline into ≤CHUNK_VERTS-vertex chunks that share a boundary vertex. */
function chunkPolyline(pts: Pt[]): Pt[][] {
  if (pts.length <= CHUNK_VERTS) return [pts];
  const chunks: Pt[][] = [];
  for (let start = 0; start < pts.length - 1; start += CHUNK_VERTS - 1) {
    chunks.push(pts.slice(start, start + CHUNK_VERTS));
  }
  return chunks;
}

/**
 * Pure: the hydrology model → the channel-carve deformations its REACHES imply.
 * Each reach contributes carve brushes along its smoothed centreline (chunked for a
 * bounded footprint), depth & half-width from the reach's spectrum class. The network
 * is rebuilt from the passed `hydro` so this stays a pure function of its inputs
 * (tests feed stub rasters); the store wrapper passes the world's real hydrology.
 */
export function buildRiverDeformations(map: GameMap, hydro: HydrologyResult): Deformation[] {
  const { width: w, height: h } = map;
  const net = buildWaterNetwork(hydro, w, h, DEFAULT_RIVER_FLOW_THRESHOLD);
  return buildRiverDeformationsFromNetwork(map, net);
}

/**
 * Carve deformations from an explicit (possibly EDITED) water network — the seam the
 * studio's drag-to-move uses to re-carve a moved channel without re-running hydrology.
 * Same per-reach centreline carve as the base path. Pure.
 */
export function buildRiverDeformationsFromNetwork(map: GameMap, net: WaterNetwork): Deformation[] {
  void map;
  const out: Deformation[] = [];
  const refFlow = referenceFlow(net);
  for (const reach of net.reaches) {
    // Both the channel WIDTH (W ∝ √Q) and the bed DEPTH (D ∝ Q^0.4) taper continuously
    // with flow: a reach is narrow + shallow at its spring and widens + deepens toward
    // its mouth, then steps up at each confluence where the spectrum class grows. The
    // class depth anchors the mouth value; `reachDepths` tapers it upstream. The bank
    // feather is sized to the DEEPEST point so the valley wall always contains the bed.
    const { depthM } = REACH_CARVE[reach.klass];
    const feather = bankFeatherTiles(depthM);
    const halfWidths = reachHalfWidths(reach, refFlow);
    const depths = reachDepths(reach, depthM);
    // Centreline is in cell-CENTRE coords (+0.5); the terrain field samples by cell
    // index (floor), so shift back to integer cell space to align the trough.
    const line: Pt[] = reach.centerline.map((p) => ({ x: p.x - 0.5, y: p.y - 0.5 }));
    chunkPolyline(line).forEach((pts, ci) => {
      const start = ci * (CHUNK_VERTS - 1);
      const hw = halfWidths.slice(start, start + pts.length);
      const dp = depths.slice(start, start + pts.length);
      out.push(
        polylineDeformation({
          id: `river:${reach.id}:${ci}`,
          source: 'river:incision',
          points: pts,
          halfWidth: hw.length ? Math.max(...hw) : 0.5,
          halfWidths: hw,
          feather,
          amount: dp.length ? Math.max(...dp) : depthM,
          amounts: dp,
          op: 'carve',
        }),
      );
    });
  }
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
