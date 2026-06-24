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
import { getWaterNetwork } from '@/world/water-network-store';
import { REACH_CARVE } from '@/world/river-deformation';
import type { Pt, WaterNetwork } from '@/terrain/river-network';

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
/** Coarse acceleration grid cell (tiles). A fragment reads only its bucket's segments. */
export const BUCKET_TILES = 8;
/** Floats per segment in the packed buffer: ax,ay,bx,by,halfA,halfB,surfA,surfB. */
export const SEG_STRIDE = 8;

export interface RiverChannelGeometry {
  width: number;
  height: number;
  /** Packed segments, `SEG_STRIDE` floats each: ax,ay,bx,by,halfA,halfB,surfA,surfB
   *  (centreline endpoints in tile coords; per-end channel half-width in tiles and the
   *  render-space bank-referenced fill surface, both lerped along the segment by t). */
  segments: Float32Array;
  segCount: number;
  /** Uniform-grid bucket dims. */
  bucketTiles: number;
  nbx: number;
  nby: number;
  /** CSR bucket index: segment ids of bucket b live in
   *  `bucketSegs[bucketOffset[b] .. bucketOffset[b+1])`. */
  bucketOffset: Uint32Array;
  bucketSegs: Uint32Array;
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
    getHeightfield(map.seed, W, H, styledIslandSpec(map.worldSeed), map.worldSeed?.pois ?? null),
    ELEVATION_SEA_LEVEL, style.terrainHeightGamma,
  );

  const bt = BUCKET_TILES;
  const nbx = Math.max(1, Math.ceil(W / bt));
  const nby = Math.max(1, Math.ceil(H / bt));
  const buckets: number[][] = Array.from({ length: nbx * nby }, () => []);
  const seg: number[] = [];
  let segCount = 0;

  for (const reach of n.reaches) {
    const halfW = REACH_CARVE[reach.klass].halfWidth;
    const cl: Pt[] = reach.centerline;
    if (cl.length < 2) continue;
    const fill = new Float32Array(cl.length);
    for (let k = 0; k < cl.length; k++) {
      const prev = cl[Math.max(0, k - 1)], next = cl[Math.min(cl.length - 1, k + 1)];
      let tx = next.x - prev.x, ty = next.y - prev.y;
      const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
      fill[k] = vertexFill(cl[k].x, cl[k].y, -ty, tx, halfW, composed, base, W, H, insetN, minDepthN);
    }
    const reach2 = halfW + BAND_MARGIN_TILES;
    for (let k = 0; k + 1 < cl.length; k++) {
      const a = cl[k], b = cl[k + 1];
      const id = segCount++;
      seg.push(a.x, a.y, b.x, b.y, halfW, halfW, fill[k], fill[k + 1]);
      // register into every bucket the expanded segment AABB overlaps
      const minBX = Math.max(0, Math.floor((Math.min(a.x, b.x) - reach2) / bt));
      const maxBX = Math.min(nbx - 1, Math.floor((Math.max(a.x, b.x) + reach2) / bt));
      const minBY = Math.max(0, Math.floor((Math.min(a.y, b.y) - reach2) / bt));
      const maxBY = Math.min(nby - 1, Math.floor((Math.max(a.y, b.y) + reach2) / bt));
      for (let by = minBY; by <= maxBY; by++) {
        for (let bx = minBX; bx <= maxBX; bx++) buckets[by * nbx + bx].push(id);
      }
    }
  }

  // CSR flatten
  const bucketOffset = new Uint32Array(nbx * nby + 1);
  for (let i = 0; i < buckets.length; i++) bucketOffset[i + 1] = bucketOffset[i] + buckets[i].length;
  const bucketSegs = new Uint32Array(bucketOffset[buckets.length]);
  for (let i = 0, o = 0; i < buckets.length; i++) for (const id of buckets[i]) bucketSegs[o++] = id;

  return {
    width: W, height: H,
    segments: Float32Array.from(seg), segCount,
    bucketTiles: bt, nbx, nby, bucketOffset, bucketSegs,
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
): { sd: number; dist: number; half: number; surf: number; flowX: number; flowY: number } | null {
  const bx = Math.min(geo.nbx - 1, Math.max(0, Math.floor(x / geo.bucketTiles)));
  const by = Math.min(geo.nby - 1, Math.max(0, Math.floor(y / geo.bucketTiles)));
  const b = by * geo.nbx + bx;
  const s = geo.segments;
  let best = Infinity, half = 0, surf = -1, flowX = 0, flowY = 0;
  for (let p = geo.bucketOffset[b]; p < geo.bucketOffset[b + 1]; p++) {
    const o = geo.bucketSegs[p] * SEG_STRIDE;
    const ax = s[o], ay = s[o + 1], bx2 = s[o + 2], by2 = s[o + 3];
    const dx = bx2 - ax, dy = by2 - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? ((x - ax) * dx + (y - ay) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + t * dx, cy = ay + t * dy;
    const d = Math.hypot(x - cx, y - cy);
    if (d < best) {
      best = d;
      half = s[o + 4] * (1 - t) + s[o + 5] * t;
      surf = s[o + 6] * (1 - t) + s[o + 7] * t;
      const fl = Math.hypot(dx, dy) || 1; flowX = dx / fl; flowY = dy / fl;
    }
  }
  if (!isFinite(best)) return null;
  return { sd: best - half, dist: best, half, surf, flowX, flowY };
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
