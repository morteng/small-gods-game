// src/render/gpu/river-channel-geometry.ts
//
// The river channel as CONNECTOME GEOMETRY for an analytic GPU distance field (spec:
// docs/superpowers/specs/2026-06-24-river-channel-sdf-design.md, slice S1).
//
// Rivers render staircased because the shader keeps a pixel only when its CELL is
// typed River — the silhouette is the per-cell classification edge. A binary mask
// stays blocky however smoothly you sample it; an analytic DISTANCE to the (already
// smooth, Catmull-Rom) centreline does not. And because the world connectome is
// REALTIME-MUTABLE, we do NOT bake a per-cell field (that re-bakes on every drag):
// instead we flatten the network into a small SEGMENT buffer the shader reads to
// compute distance directly, plus a per-tile BUCKET index so each fragment tests only
// its 1–4 local segments. Editing a node re-emits a few KB of geometry — no re-bake.
//
// This is the CPU half (S1): pure, memoised, byte-identical to today (no GPU/shader
// touch yet — that is S2). Verified numerically by the unit tests.

import type { GameMap } from '@/core/types';
import { worldStyleOf } from '@/core/world-style';
import { heightField, curveHeightBuffer } from '@/render/gpu/terrain-field';
import { getHeightfield, ELEVATION_SEA_LEVEL } from '@/world/heightfield';
import { styledIslandSpec } from '@/terrain/island-mask';
import { styledShapeSpec } from '@/terrain/terrain-shape';
import { getWaterNetwork } from '@/world/water-network-store';
import {
  binFeatureSegments, segDist, FEATURE_SEG_STRIDE, FEATURE_BUCKET_TILES,
  type FeatureSeg, type BinnedFeatures,
} from '@/render/gpu/feature-geometry';
import { referenceFlow, reachHalfWidths, type Pt, type WaterNetwork } from '@/terrain/river-network';

/** Metres the surface sits below the lower bank (min inset) — matches river-surface-field. */
const SURFACE_INSET_M = 0.5;
/** Inset as a fraction of the local incision — matches river-surface-field. */
const INSET_DEPTH_FRACTION = 0.6;
/** Minimum depth kept over the bed so a weakly-carved reach still shows water. */
const MIN_DEPTH_M = 0.35;
/** Tiles past the half-width to read the bank top when referencing the fill level. */
const BANK_PROBE_TILES = 2.5;
/** Extra band (tiles) beyond each channel half-width that a segment registers into
 *  buckets, so a fragment just outside the channel still finds the segment to measure
 *  against (the shader needs valid distance on BOTH sides of the `sd=0` silhouette). */
const BAND_MARGIN_TILES = 3;
/** Coarse acceleration grid cell (tiles). A fragment reads only its bucket's segments.
 *  Aliased to the shared feature-geometry constant — rivers and roads bin identically. */
export const BUCKET_TILES = FEATURE_BUCKET_TILES;
/** Floats per segment in the packed buffer: ax,ay,bx,by,halfA,halfB,surfA,surfB.
 *  Aliased to the shared feature-geometry stride. */
export const SEG_STRIDE = FEATURE_SEG_STRIDE;

export interface RiverChannelGeometry extends BinnedFeatures {
  // segments/segCount/bucketTiles/nbx/nby/bucketOffset/bucketSegs come from BinnedFeatures
  // (the shared bin result; `segments` carries SEG_STRIDE floats each: ax,ay,bx,by,
  // halfA,halfB,surfA,surfB — per-end channel half-width and bank-referenced fill surface).
  width: number;
  height: number;
  /** The GPU upload: all three arrays concatenated into ONE u32 buffer so the water
   *  fragment shader stays within the 8-storage-buffer baseline limit (it already reads
   *  7 per-cell fields). Layout:
   *    [bucketOffset : nbx*nby+1 words] [bucketSegs : R words] [segments : segCount*8 words]
   *  where R = bucketOffset[nbx*nby] (the last offset = total seg refs), and the segment
   *  floats are bit-reinterpreted as u32 (the shader bitcasts them back). */
  packed: Uint32Array;
}

/** Bilinear sample of a row-major W*H field at continuous (x,y), clamped at edges. */
function sampleBilinear(f: Float32Array, W: number, H: number, x: number, y: number): number {
  const xc = Math.min(W - 1, Math.max(0, x));
  const yc = Math.min(H - 1, Math.max(0, y));
  const x0 = Math.floor(xc), y0 = Math.floor(yc);
  const x1 = Math.min(W - 1, x0 + 1), y1 = Math.min(H - 1, y0 + 1);
  const fx = xc - x0, fy = yc - y0;
  const a = f[y0 * W + x0], b = f[y0 * W + x1], c = f[y1 * W + x0], d = f[y1 * W + x1];
  return a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy;
}

/**
 * Bank-referenced fill level at a centreline vertex, in normalised render elevation.
 * Mirrors `river-surface-field`'s rule (contain the water below the lower bank, depth-
 * scaled inset, never below a minimum over the bed) — evaluated per vertex off the smooth
 * centreline, so the fill follows the channel rather than the raster cell grid.
 */
function vertexFill(
  vx: number, vy: number, nx: number, ny: number, half: number,
  composed: Float32Array, base: Float32Array, W: number, H: number,
  insetN: number, minDepthN: number,
): number {
  const bed = sampleBilinear(composed, W, H, vx, vy);
  const probe = half + BANK_PROBE_TILES;
  const bl = sampleBilinear(base, W, H, vx + nx * probe, vy + ny * probe);
  const br = sampleBilinear(base, W, H, vx - nx * probe, vy - ny * probe);
  const bankMin = Math.min(bl, br);
  const incision = Math.max(0, bankMin - bed);
  const inset = Math.max(insetN, INSET_DEPTH_FRACTION * incision);
  return Math.max(bankMin - inset, bed + minDepthN);
}

/**
 * Flatten the (optionally edited) water network into the segment + bucket geometry the
 * GPU analytic channel reads. Pure: depends only on the network + the memoised render
 * heightfields. Cheap to re-run on a connectome edit (re-emit, no re-bake).
 */
export function buildRiverChannelGeometry(map: GameMap, net?: WaterNetwork): RiverChannelGeometry {
  const W = map.width, H = map.height;
  const n = net ?? getWaterNetwork(map);
  const style = worldStyleOf(map.worldSeed);
  const relief = style.mountainRelief;
  const insetN = SURFACE_INSET_M / relief;
  const minDepthN = MIN_DEPTH_M / relief;

  const composed = heightField(map);
  const base = curveHeightBuffer(
    getHeightfield(map.seed, W, H, styledIslandSpec(map.worldSeed), map.worldSeed?.pois ?? null, styledShapeSpec(map.worldSeed)),
    ELEVATION_SEA_LEVEL, style.terrainHeightGamma,
  );

  // Flatten reaches into feature segments (shared substrate with roads/walls), then bin
  // into the per-tile buckets. River's surface scalar (surfA/surfB) is the bank-referenced
  // fill elevation; reach = halfWidth + a band margin so a fragment just outside the
  // channel still finds the segment to measure against.
  const segs: FeatureSeg[] = [];
  const refFlow = referenceFlow(n);
  for (const reach of n.reaches) {
    const cl: Pt[] = reach.centerline;
    if (cl.length < 2) continue;
    // Per-vertex half-width tapers with flow (W ∝ √Q) — the same profile the carve uses,
    // so the rendered channel edge and the carved trough agree end-to-end.
    const half = reachHalfWidths(reach, refFlow);
    const fill = new Float32Array(cl.length);
    for (let k = 0; k < cl.length; k++) {
      const prev = cl[Math.max(0, k - 1)], next = cl[Math.min(cl.length - 1, k + 1)];
      let tx = next.x - prev.x, ty = next.y - prev.y;
      const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
      fill[k] = vertexFill(cl[k].x, cl[k].y, -ty, tx, half[k], composed, base, W, H, insetN, minDepthN);
    }
    for (let k = 0; k + 1 < cl.length; k++) {
      const a = cl[k], b = cl[k + 1];
      const reach2 = Math.max(half[k], half[k + 1]) + BAND_MARGIN_TILES;
      segs.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y, halfA: half[k], halfB: half[k + 1], surfA: fill[k], surfB: fill[k + 1], reach: reach2 });
    }
  }

  const binned = binFeatureSegments(segs, W, H, BUCKET_TILES);
  const { segments, segCount, nbx, nby, bucketOffset, bucketSegs } = binned;

  // Concatenate into ONE u32 buffer for the GPU (8-storage-buffer budget; the water pass
  // passes the bucket dims via its uniform, so this buffer is HEADERLESS unlike the road
  // buffer). The segment floats are bit-reinterpreted as u32; the shader bitcasts back.
  const offLen = nbx * nby + 1;
  const segWords = segCount * SEG_STRIDE;
  const packed = new Uint32Array(offLen + bucketSegs.length + segWords);
  packed.set(bucketOffset, 0);
  packed.set(bucketSegs, offLen);
  packed.set(new Uint32Array(segments.buffer, segments.byteOffset, segWords), offLen + bucketSegs.length);

  return {
    width: W, height: H,
    segments, segCount,
    bucketTiles: binned.bucketTiles, nbx, nby, bucketOffset, bucketSegs, packed,
  };
}

/**
 * Nearest-segment query — the CPU mirror of the shader's per-fragment loop, so a wetness
 * oracle (S3) and the tests agree with the paint exactly. Returns the signed distance
 * `dist − half` (negative inside the channel) plus the interpolated fill surface and the
 * downstream flow direction at the nearest point, or null when no segment is in range.
 */
export function channelAt(
  geo: RiverChannelGeometry, x: number, y: number,
): { sd: number; dist: number; half: number; surf: number; flowX: number; flowY: number; slope: number } | null {
  const bx = Math.min(geo.nbx - 1, Math.max(0, Math.floor(x / geo.bucketTiles)));
  const by = Math.min(geo.nby - 1, Math.max(0, Math.floor(y / geo.bucketTiles)));
  const b = by * geo.nbx + bx;
  const s = geo.segments;
  let best = Infinity, half = 0, surf = -1, flowX = 0, flowY = 0, slope = 0;
  for (let p = geo.bucketOffset[b]; p < geo.bucketOffset[b + 1]; p++) {
    const o = geo.bucketSegs[p] * SEG_STRIDE;
    const ax = s[o], ay = s[o + 1], bx2 = s[o + 2], by2 = s[o + 3];
    const { t, d } = segDist(ax, ay, bx2, by2, x, y);
    if (d < best) {
      best = d;
      half = s[o + 4] * (1 - t) + s[o + 5] * t;
      const surfA = s[o + 6], surfB = s[o + 7];
      surf = surfA * (1 - t) + surfB * t;
      const dx = bx2 - ax, dy = by2 - ay;
      const fl = Math.hypot(dx, dy) || 1; flowX = dx / fl; flowY = dy / fl;
      // Reach gradient: water-surface fall (surfA→surfB, upstream→downstream) per tile, in
      // normalised elevation units. The shader's twin scales this by relief to metres; the
      // whitewater read keys off it. Non-negative (local reversals from smoothing clamp to 0).
      slope = Math.max(surfA - surfB, 0) / fl;
    }
  }
  if (!isFinite(best)) return null;
  return { sd: best - half, dist: best, half, surf, flowX, flowY, slope };
}

// ── Memoise per (seed, dims), like the sibling render-water stores ──
const cache = new Map<string, RiverChannelGeometry>();
const CACHE_CAP = 4;

/** Memoised channel geometry, or null when the world has no rivers. */
export function getRiverChannelGeometry(map: GameMap): RiverChannelGeometry | null {
  const net = getWaterNetwork(map);
  if (net.reaches.length === 0) return null;
  const k = `${map.seed}:${map.width}x${map.height}`;
  let f = cache.get(k);
  if (f) return f;
  f = buildRiverChannelGeometry(map, net);
  cache.set(k, f);
  if (cache.size > CACHE_CAP) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return f;
}

/** Drop the memoised geometry (tests; harmless in prod). */
export function clearRiverChannelGeometryCache(): void {
  cache.clear();
}
