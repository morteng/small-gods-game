// src/render/gpu/feature-geometry.ts
//
// LINEAR FEATURES as analytic GPU geometry — the shared substrate behind roads,
// rivers (and, ahead, walls/building plinths). Spec:
// docs/superpowers/specs/2026-06-25-linear-features-vector-sdf-adaptive-terrain.md.
//
// A feature is "the same thing to the terrain": a smooth vector CENTRELINE + a
// per-end half-width + a per-end SURFACE scalar. Instead of baking a per-cell
// field (which freezes the carriageway/channel edge to the 2 m grid — the
// "zig-zag roads" artifact — and re-bakes on every connectome edit), we flatten
// the feature into a small SEGMENT buffer the shader reads to compute DISTANCE to
// the centreline directly, plus a per-tile BUCKET index so each fragment tests
// only its 1–4 local segments. The river channel (river-channel-geometry.ts) was
// the proving ground; this is the generalised core it now shares.
//
// `binFeatureSegments` is the shared bucket-binning + CSR flatten (used by BOTH
// the road buffer here and the river channel). The ROAD half builds the terrain
// pass's pavedness buffer (replacing the old super-sampled per-cell `roadSurface`)
// and its CPU mirror `roadPavednessAt`, byte-equivalent to the retired field.

import type { GameMap } from '@/core/types';
import { edgeRoadProfile } from '@/world/road-deformation';
import type { SurfaceMaterial } from '@/world/road-state';

/** Floats per segment in the packed buffer: ax,ay,bx,by,halfA,halfB,surfA,surfB
 *  (centreline endpoints in tile coords; per-end half-width in tiles and a per-end
 *  surface scalar — river: bank-referenced fill elev; road: pavedness — both lerped
 *  along the segment by the projection parameter t). Matches the river layout so one
 *  shader walk serves every feature kind. */
export const FEATURE_SEG_STRIDE = 8;

/** Coarse acceleration grid cell (tiles). A fragment reads only its bucket's segments. */
export const FEATURE_BUCKET_TILES = 8;

/** One feature segment for binning: the 8 packed floats plus the bucket-registration
 *  `reach` (≥ its half-width) so a fragment just outside the surface still finds it. */
export interface FeatureSeg {
  ax: number; ay: number; bx: number; by: number;
  halfA: number; halfB: number;
  surfA: number; surfB: number;
  reach: number;
}

/** The bucket-binned result: the packed segment floats + a CSR index by tile bucket.
 *  Segment ids of bucket b live in `bucketSegs[bucketOffset[b] .. bucketOffset[b+1])`. */
export interface BinnedFeatures {
  segments: Float32Array;   // segCount * FEATURE_SEG_STRIDE
  segCount: number;
  bucketTiles: number;
  nbx: number;
  nby: number;
  bucketOffset: Uint32Array;
  bucketSegs: Uint32Array;
}

/**
 * Bin feature segments into a uniform tile-bucket grid and CSR-flatten the index.
 * Each segment registers into every bucket its AABB expanded by `seg.reach` overlaps,
 * so a fragment within `reach` of the centreline finds the segment in its own bucket.
 * Pure + deterministic (segment + bucket order follow input order).
 */
export function binFeatureSegments(
  segs: FeatureSeg[], W: number, H: number, bucketTiles = FEATURE_BUCKET_TILES,
): BinnedFeatures {
  const bt = bucketTiles;
  const nbx = Math.max(1, Math.ceil(W / bt));
  const nby = Math.max(1, Math.ceil(H / bt));
  const buckets: number[][] = Array.from({ length: nbx * nby }, () => []);
  const seg = new Float32Array(segs.length * FEATURE_SEG_STRIDE);

  for (let id = 0; id < segs.length; id++) {
    const s = segs[id];
    const o = id * FEATURE_SEG_STRIDE;
    seg[o] = s.ax; seg[o + 1] = s.ay; seg[o + 2] = s.bx; seg[o + 3] = s.by;
    seg[o + 4] = s.halfA; seg[o + 5] = s.halfB; seg[o + 6] = s.surfA; seg[o + 7] = s.surfB;
    const r = s.reach;
    const minBX = Math.max(0, Math.floor((Math.min(s.ax, s.bx) - r) / bt));
    const maxBX = Math.min(nbx - 1, Math.floor((Math.max(s.ax, s.bx) + r) / bt));
    const minBY = Math.max(0, Math.floor((Math.min(s.ay, s.by) - r) / bt));
    const maxBY = Math.min(nby - 1, Math.floor((Math.max(s.ay, s.by) + r) / bt));
    for (let by = minBY; by <= maxBY; by++) {
      for (let bx = minBX; bx <= maxBX; bx++) buckets[by * nbx + bx].push(id);
    }
  }

  const bucketOffset = new Uint32Array(nbx * nby + 1);
  for (let i = 0; i < buckets.length; i++) bucketOffset[i + 1] = bucketOffset[i] + buckets[i].length;
  const bucketSegs = new Uint32Array(bucketOffset[buckets.length]);
  for (let i = 0, p = 0; i < buckets.length; i++) for (const id of buckets[i]) bucketSegs[p++] = id;

  return { segments: seg, segCount: segs.length, bucketTiles: bt, nbx, nby, bucketOffset, bucketSegs };
}

/** Closest-point parameter t∈[0,1] of (px,py) on segment (ax,ay)-(bx,by) + the distance.
 *  Shared by every feature CPU mirror (road pavedness, river channel) so the segment math
 *  lives in exactly one place. */
export function segDist(ax: number, ay: number, bx: number, by: number, px: number, py: number): { t: number; d: number } {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = ax + t * dx, cy = ay + t * dy;
  return { t, d: Math.hypot(px - cx, py - cy) };
}

// ── ROAD pavedness as feature geometry ────────────────────────────────────────────

/** Surface material → base pavedness (how hard/stone-like the running surface reads). */
const PAVEDNESS: Record<SurfaceMaterial, number> = { dirt: 0.2, gravel: 0.45, cobble: 0.75, paved: 1.0 };

/** Carriageway shoulder lip beyond the carriage half-width (tiles) — where pavedness
 *  fades out. Kept narrow so the paved surface hugs the carriageway instead of
 *  bleeding a wide apron into the verge. */
const SHOULDER_LIP_TILES = 0.18;
/** Pavedness holds full inside this fraction of the half-width, then feathers to 0. */
const ROAD_CORE_FRACTION = 0.7;

/** The road feature buffer for the terrain/detail passes: bucket-binned segments plus a
 *  SELF-DESCRIBING packed u32 buffer (4-word header so the shader needs no extra uniform). */
export interface RoadFeatureGeometry extends BinnedFeatures {
  width: number;
  height: number;
  /** GPU upload (one u32 buffer; segment floats bit-reinterpreted). Layout:
   *    [bucketTiles, nbx, nby, segCount]              (4-word header)
   *    [bucketOffset : nbx*nby+1 words]
   *    [bucketSegs   : R words]   R = bucketOffset[nbx*nby]
   *    [segments     : segCount*FEATURE_SEG_STRIDE words]
   *  The shader reads the header from word 0, so dims ride the buffer, not a uniform. */
  packed: Uint32Array;
}

/** Pack binned features into the self-describing u32 buffer the terrain shader reads. */
function packSelfDescribing(b: BinnedFeatures): Uint32Array {
  const nb = b.nbx * b.nby;
  const offLen = nb + 1;
  const segWords = b.segCount * FEATURE_SEG_STRIDE;
  const out = new Uint32Array(4 + offLen + b.bucketSegs.length + segWords);
  out[0] = b.bucketTiles; out[1] = b.nbx; out[2] = b.nby; out[3] = b.segCount;
  out.set(b.bucketOffset, 4);
  out.set(b.bucketSegs, 4 + offLen);
  out.set(new Uint32Array(b.segments.buffer, b.segments.byteOffset, segWords), 4 + offLen + b.bucketSegs.length);
  return out;
}

/**
 * Pure: a world → its road pavedness as analytic feature geometry. Each road edge's
 * smoothed centreline contributes segments carrying the carriageway half-width and the
 * edge's pavedness (material × condition, dimmed by overgrowth). The shader (and the CPU
 * mirror) compute pavedness analytically from distance to the centreline — the
 * carriageway edge is no longer quantised to the 2 m grid.
 */
export function buildRoadFeatureGeometry(map: GameMap): RoadFeatureGeometry {
  const W = map.width, H = map.height;
  const graph = map.roadGraph;
  const segs: FeatureSeg[] = [];
  if (graph) {
    const nodeById = new Map(graph.nodes.map((nd) => [nd.id, nd]));
    const poiById = new Map((map.worldSeed?.pois ?? []).map((p) => [p.id, p]));
    for (const edge of graph.edges) {
      const profile = edgeRoadProfile(map, edge, nodeById, poiById);
      if (!profile) continue;
      const { centerline, state, x } = profile;
      const paved = Math.max(0, Math.min(1, PAVEDNESS[state.surfaceMaterial] * state.condition * (1 - 0.7 * state.overgrowth)));
      if (paved <= 0) continue;
      const half = x.carriageHalf + SHOULDER_LIP_TILES;
      const reach = half + 0.5;
      for (let k = 0; k + 1 < centerline.length; k++) {
        const a = centerline[k], b = centerline[k + 1];
        segs.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y, halfA: half, halfB: half, surfA: paved, surfB: paved, reach });
      }
    }
  }
  const binned = binFeatureSegments(segs, W, H);
  return { width: W, height: H, ...binned, packed: packSelfDescribing(binned) };
}

/**
 * CPU mirror of the shader's road pavedness — the MAX of `paved · fade(d)` over the
 * fragment's bucket segments (fade = 1 inside the core, tapering to 0 at the half-width).
 * Byte-equivalent to the retired per-cell `buildRoadSurfaceField`: max over segments of
 * `paved·fade(d_seg)` equals `paved·fade(min d_seg)` since fade decreases in d, so the
 * old "min distance to the polyline, then fade" gives the identical value.
 */
export function roadPavednessAt(geo: RoadFeatureGeometry, x: number, y: number): number {
  if (geo.segCount === 0) return 0;
  const bx = Math.min(geo.nbx - 1, Math.max(0, Math.floor(x / geo.bucketTiles)));
  const by = Math.min(geo.nby - 1, Math.max(0, Math.floor(y / geo.bucketTiles)));
  const b = by * geo.nbx + bx;
  const s = geo.segments;
  let best = 0;
  for (let p = geo.bucketOffset[b]; p < geo.bucketOffset[b + 1]; p++) {
    const o = geo.bucketSegs[p] * FEATURE_SEG_STRIDE;
    const { t, d } = segDist(s[o], s[o + 1], s[o + 2], s[o + 3], x, y);
    const half = s[o + 4] * (1 - t) + s[o + 5] * t;
    if (d > half) continue;
    const core = half * ROAD_CORE_FRACTION;
    const fade = d <= core ? 1 : 1 - (d - core) / (half - core);
    const v = (s[o + 6] * (1 - t) + s[o + 7] * t) * fade;
    if (v > best) best = v;
  }
  return best;
}

// ── Memoised per (seed, dims, roadGraph.rev) — static for a world until roads evolve ──
const roadCache = new Map<string, RoadFeatureGeometry>();
const CACHE_CAP = 4;

/** Memoised road feature geometry (always valid — segCount 0 when the world has no
 *  roads, so the shader uploads a header-only buffer). */
export function getRoadFeatureGeometry(map: GameMap): RoadFeatureGeometry {
  const k = `${map.seed}:${map.width}x${map.height}:r${map.roadGraph?.rev ?? 0}`;
  const hit = roadCache.get(k);
  if (hit) return hit;
  const geo = buildRoadFeatureGeometry(map);
  roadCache.set(k, geo);
  if (roadCache.size > CACHE_CAP) {
    const oldest = roadCache.keys().next().value;
    if (oldest !== undefined) roadCache.delete(oldest);
  }
  return geo;
}

/** Drop the memo (tests; harmless in prod). */
export function clearRoadFeatureGeometryCache(): void {
  roadCache.clear();
}
