// src/world/road-deformation.ts
//
// Roads → terrain GRADE-CUT. The "down" half of the road↔terrain coupling
// (design doc §6): a road doesn't just paint dirt tiles, it cuts a level shelf
// into the slope it threads. This is the first producer to feed the shared
// deformation channel (`terrain-deformation.ts`) from the roads epic — the
// `heightAt = baseSeedHeight ⊕ deformations` contract, finally exercised.
//
// Model (deterministic, pure, save-safe):
//   * Each road edge's polyline is the source of truth (Slice 0 promoted it).
//   * Per unit segment we drop a `polylineDeformation` with op 'level' toward the
//     segment's MEAN base height — cut-and-fill: where the hill rises above the
//     local grade the ground is lowered (cut), where it dips below it is raised
//     (fill). Adjacent segments share a vertex so the target steps smoothly along
//     the route → a graded ramp, not a staircase. The shoulder feather tapers the
//     cut back to untouched terrain (no cliff at the road edge).
//   * Roads only (feature === 'road'); rivers (carve) + walls are later slices.
//
// Determinism & save-safety: deformations are DERIVED from `map.roadGraph` (which
// IS persisted) + the seed heightfield. Nothing here is persisted; it re-derives
// identically on load, exactly like `getHeightfield`. Both the store and the
// composed field are memoised per (seed, dims) so the build cost is paid once,
// not per frame.
import type { GameMap } from '@/core/types';
import type { RoadGraph, RoadClass } from '@/world/road-graph';
import {
  DeformationStore,
  polylineDeformation,
  baseHeightAt,
  heightAt,
  type Deformation,
} from '@/world/terrain-deformation';
import { getHeightfield, ELEVATION_SEA_LEVEL } from '@/world/heightfield';
import { styledIslandSpec } from '@/terrain/island-mask';
import { worldStyleOf } from '@/core/world-style';
import { buildRiverDeformations } from '@/world/river-deformation';
import { getHydrologyResult } from '@/world/hydrology-store';

/** Corridor half-width in TILES by road class (a tile is 2 m). Highways cut a
 *  wider shelf than footpaths. */
const HALF_WIDTH_TILES: Record<RoadClass, number> = {
  highway: 1.4,
  road: 1.0,
  track: 0.7,
  path: 0.5,
};

/** Shoulder taper beyond the corridor, in tiles — the cut blends back to base
 *  over this distance so there is no cliff at the road edge. */
const SHOULDER_FEATHER_TILES = 1.5;

/**
 * Pure: a road graph → the grade-cut deformations its edges imply. One 'level'
 * brush per unit segment, targeting that segment's mean base height. Rivers and
 * walls are skipped (separate producers). `map` is read for base heights only.
 */
export function buildRoadDeformations(map: GameMap, graph: RoadGraph): Deformation[] {
  const out: Deformation[] = [];
  for (const edge of graph.edges) {
    if (edge.feature !== 'road') continue;
    const pts = edge.polyline;
    if (pts.length < 2) continue;
    const halfWidth = HALF_WIDTH_TILES[edge.class] ?? HALF_WIDTH_TILES.road;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      // Mean base height of the segment endpoints (metres) is the local grade the
      // shelf levels toward — cut above it, fill below it.
      const target = (baseHeightAt(map, a.x, a.y) + baseHeightAt(map, b.x, b.y)) / 2;
      out.push(
        polylineDeformation({
          id: `${edge.id}:${i}`,
          source: 'road:cut',
          points: [a, b],
          halfWidth,
          feather: SHOULDER_FEATHER_TILES,
          amount: 0, // unused by 'level'
          op: 'level',
          target,
        }),
      );
    }
  }
  return out;
}

// ── Memoised stores + composed fields, keyed by (seed, dims) like getHeightfield ──

const storeCache = new Map<string, DeformationStore>();
const fieldCache = new Map<string, Float32Array>();
const CACHE_CAP = 4;

function key(map: GameMap): string {
  return `${map.seed}:${map.width}x${map.height}`;
}

function evict(cache: Map<string, unknown>): void {
  if (cache.size > CACHE_CAP) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

/**
 * The road deformation store for a world — memoised. Empty (size 0) when the map
 * has no road graph, so consumers compose to exact base-terrain parity.
 */
export function getRoadDeformationStore(map: GameMap): DeformationStore {
  const k = key(map);
  let store = storeCache.get(k);
  if (store) return store;
  store = new DeformationStore();
  if (map.roadGraph) store.add(...buildRoadDeformations(map, map.roadGraph));
  storeCache.set(k, store);
  evict(storeCache);
  return store;
}

// ── Merged WORLD store: road grade-cuts ⊕ river incision (memoised) ──
const worldStoreCache = new Map<string, DeformationStore>();

/**
 * The full terrain-deformation store for a world — road grade-cuts AND river
 * incision, composed into one store (priority/id order handles overlaps where a
 * road bridges a river). This is what the renderer and composed heightfield read;
 * `getRoadDeformationStore` stays road-only for callers that want just roads.
 */
export function getWorldDeformationStore(map: GameMap): DeformationStore {
  const k = key(map);
  let store = worldStoreCache.get(k);
  if (store) return store;
  store = new DeformationStore();
  if (map.roadGraph) store.add(...buildRoadDeformations(map, map.roadGraph));
  store.add(...buildRiverDeformations(map, getHydrologyResult(map)));
  worldStoreCache.set(k, store);
  evict(worldStoreCache);
  return store;
}

/**
 * The world's NORMALISED `[0,1]` elevation field with road grade-cuts AND river
 * incision composed in — what the GPU terrain mesh lifts. Returns the SAME base
 * array instance (zero cost, byte-parity) when there are no deformations at all.
 * Memoised by (seed, dims, store version); callers must treat it read-only.
 */
export function getComposedHeightfield(map: GameMap): Float32Array {
  const base = getHeightfield(map.seed, map.width, map.height, styledIslandSpec(map.worldSeed), map.worldSeed?.pois ?? null);
  const store = getWorldDeformationStore(map);
  if (store.size === 0) return base; // parity by construction

  const k = `${key(map)}:v${store.version}`;
  const cached = fieldCache.get(k);
  if (cached) return cached;

  const { width, height } = map;
  // Use the SAME styled relief the renderer reads (inverse of heightMetresAt), so
  // a metre-deformation embeds into normalised space at the world's actual scale.
  // Defaults to TERRAIN_RELIEF_M, so unstyled worlds are byte-identical.
  const relief = worldStyleOf(map.worldSeed).mountainRelief;
  const out = new Float32Array(width * height);
  for (let ty = 0; ty < height; ty++) {
    for (let tx = 0; tx < width; tx++) {
      // heightAt composes deformations in metres; convert back to the normalised
      // [0,1] range the height buffer carries (inverse of heightMetresAt).
      const m = heightAt(map, store, tx, ty);
      out[ty * width + tx] = m / relief + ELEVATION_SEA_LEVEL;
    }
  }
  fieldCache.set(k, out);
  evict(fieldCache);
  return out;
}

/** Drop memoised stores + composed fields (tests; harmless in prod). */
export function clearRoadDeformationCache(): void {
  storeCache.clear();
  worldStoreCache.clear();
  fieldCache.clear();
}
