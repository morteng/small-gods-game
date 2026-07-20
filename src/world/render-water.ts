// src/world/render-water.ts
//
// THE "is there water the player can SEE here?" predicate — the ONE render-water truth every
// consumer that must agree with the drawn channel reads (mill-site WCV-87 pattern, generalised).
//
// Why this exists: `map.tiles[y][x].type` is NOT the visible water. Two independent lies:
//   * roads CARVE 'bridge'/'dirt_road' straight over the channel at a crossing, so the tile grid
//     forgets there was ever water exactly where the crossing is;
//   * the drawn river is the connectome ribbon (`buildRenderWaterType` — the W ∝ √Q disc swath
//     along each reach's smoothed centreline, the same curve the carve follows), which meanders
//     up to a tile off the D8 raster line the tiles were classified from.
// A consumer reading the raster therefore sites decks beside the water, paints cobble across it,
// and lints a symptom instead of the cause. Everything that must line up with the DRAWN water —
// crossing bank siting, the road ribbon's yield-to-river, the bridge lint — reads THIS.
//
// Render water = the connectome ribbon (river discs + ocean + lakes) UNION the standing water the
// tile grid still carries. The union is what makes it a strict superset of the tile raster: a cell
// that is render-DRY is tile-dry too, so a bank seated on render-dry ground is seated, full stop.
//
// Pure + map-derived (never persisted): `buildRenderWaterTypeMemo` re-derives from the hydrology
// raster + water connectome, both themselves memoised views of (seed, dims). So this returns the
// same answer at worldgen, after a save/load, in the renderer and in the linter.

import type { GameMap } from '@/core/types';
import { WaterType } from '@/core/types';
import { WATER_TYPES } from '@/core/constants';
import { buildRenderWaterTypeMemo } from '@/render/gpu/render-water-mask';
import { getWaterNetwork } from '@/world/water-network-store';
import { referenceFlow, reachHalfWidths } from '@/terrain/river-network';
import {
  binFeatureSegments, segDist, FEATURE_SEG_STRIDE, type FeatureSeg, type BinnedFeatures,
} from '@/render/gpu/feature-geometry';

/** "Is (x,y) water the player can see?" — off-map reads false. */
export type WaterPredicate = (x: number, y: number) => boolean;

/** Signed distance (tiles) from a CONTINUOUS point to the drawn water's edge —
 *  negative inside the water, positive on dry ground, clamped to ±WATER_DIST_CAP. */
export type WaterDistance = (x: number, y: number) => number;

/**
 * The render-water predicate for a map. Memoised through `buildRenderWaterTypeMemo` (seed+dims
 * keyed), so calling this per-edge / per-cell is cheap. A map with no hydrology (studio ground,
 * bare test stub) degrades to the tile grid alone, which is exactly right there — no connectome,
 * no ribbon, so the tiles ARE the visible water.
 */
export function getRenderWaterMask(map: GameMap): WaterPredicate {
  const W = map.width, H = map.height;
  let ribbon: Uint8Array | null = null;
  try {
    ribbon = buildRenderWaterTypeMemo(map);
  } catch {
    ribbon = null;   // no hydrology on this map — tiles are the only water signal
  }
  return (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= W || y >= H) return false;
    if (ribbon && ribbon[y * W + x] !== WaterType.Dry) return true;
    // `tiles` is optional-chained throughout: a partial map view (the road-occupancy mask
    // worldgen builds mid-generation, a bare render fixture) legitimately carries no tile grid.
    return WATER_TYPES.has(map.tiles?.[y]?.[x]?.type ?? '');
  };
}

// ---------------------------------------------------------------------------------------
// CONTINUOUS render-water distance — the sub-tile half of the same truth.
//
// The cell mask above is the raster QUANTIZATION of the drawn water (`stampDisc` marks a
// cell River when its CENTRE falls inside the swath), and streams go down to half-width
// 0.32 tiles — well under a cell. A consumer that gates an entity's FOOT on the cell mask
// is therefore correct against the raster and wrong against the picture: a tuft placed at
// a dry-CENTRED cell's water-side fraction stands in the middle of the drawn stream
// (measured: 38 nature entities inside the channel on seed 777, every one on a mask-dry
// cell). Anything with a continuous position — entity feet, placement rolls — must gate
// on THIS; the cell mask remains the right view for per-cell work (bed colour, tile
// stamps). Both derive from the same network + reachHalfWidths, so they cannot drift.
// ---------------------------------------------------------------------------------------

/** Distances are clamped to ±this (tiles); beyond it "how far" carries no meaning. */
export const WATER_DIST_CAP = 4;

/** Chamfer 3-4 weights /3 ≈ Euclid at cell resolution — plenty under WATER_DIST_CAP. */
const CHAMFER_AXIS = 1;
const CHAMFER_DIAG = 4 / 3;

interface WaterDistField {
  ribbon: BinnedFeatures | null;   // stream/river swath segments, per-vertex half-widths
  blob: Float32Array;              // cell-resolution signed distance to lake/ocean/tile water
  W: number;
  H: number;
}

/** Two-pass chamfer distance (tiles) to the nearest `true` cell; Infinity-free (capped). */
function chamfer(wet: Uint8Array, W: number, H: number): Float32Array {
  const d = new Float32Array(W * H).fill(WATER_DIST_CAP + 1);
  for (let i = 0; i < d.length; i++) if (wet[i]) d[i] = 0;
  const relax = (i: number, j: number, w: number): void => {
    if (d[j] + w < d[i]) d[i] = d[j] + w;
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (x > 0) relax(i, i - 1, CHAMFER_AXIS);
      if (y > 0) relax(i, i - W, CHAMFER_AXIS);
      if (x > 0 && y > 0) relax(i, i - W - 1, CHAMFER_DIAG);
      if (x < W - 1 && y > 0) relax(i, i - W + 1, CHAMFER_DIAG);
    }
  }
  for (let y = H - 1; y >= 0; y--) {
    for (let x = W - 1; x >= 0; x--) {
      const i = y * W + x;
      if (x < W - 1) relax(i, i + 1, CHAMFER_AXIS);
      if (y < H - 1) relax(i, i + W, CHAMFER_AXIS);
      if (x < W - 1 && y < H - 1) relax(i, i + W + 1, CHAMFER_DIAG);
      if (x > 0 && y < H - 1) relax(i, i + W - 1, CHAMFER_DIAG);
    }
  }
  return d;
}

function buildWaterDistField(map: GameMap): WaterDistField {
  const W = map.width, H = map.height;

  // The connectome ribbon: one segment per centreline step, carrying the SAME per-vertex
  // half-widths the carve / channel geometry / cell stamp consume. Bucket registration
  // reach = half-width + cap so any query needing a finite answer finds its segment.
  let ribbon: BinnedFeatures | null = null;
  let hasNet = false;
  try {
    const net = getWaterNetwork(map);
    const refFlow = referenceFlow(net);
    const segs: FeatureSeg[] = [];
    for (const reach of net.reaches) {
      const cl = reach.centerline;
      const hw = reachHalfWidths(reach, refFlow);
      for (let i = 0; i < cl.length - 1; i++) {
        segs.push({
          ax: cl[i].x, ay: cl[i].y, bx: cl[i + 1].x, by: cl[i + 1].y,
          halfA: hw[i], halfB: hw[i + 1], surfA: 0, surfB: 0,
          reach: Math.max(hw[i], hw[i + 1]) + WATER_DIST_CAP,
        });
      }
    }
    ribbon = segs.length > 0 ? binFeatureSegments(segs, W, H) : null;
    hasNet = true;
  } catch {
    ribbon = null;   // no hydrology — tiles are the only water signal (mask degrade path)
  }

  // Area water at cell resolution: lakes + ocean (already smooth blobs), plus the tile
  // grid's standing water. Raster RIVER cells are excluded whenever the network exists —
  // the ribbon above IS those rivers, drawn; the D8 staircase they were classified from
  // diverges from it by up to a tile. Without a network the tiles are the drawn water
  // (same degrade rule as the mask), so every water type counts.
  const wet = new Uint8Array(W * H);
  let ribbonMask: Uint8Array | null = null;
  try {
    ribbonMask = buildRenderWaterTypeMemo(map);
  } catch {
    ribbonMask = null;
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const rm = ribbonMask ? ribbonMask[i] : WaterType.Dry;
      if (rm === WaterType.Ocean || rm === WaterType.Lake) { wet[i] = 1; continue; }
      const t = map.tiles?.[y]?.[x]?.type ?? '';
      if (WATER_TYPES.has(t) && !(hasNet && t === 'river')) wet[i] = 1;
    }
  }
  const toWet = chamfer(wet, W, H);
  const dry = new Uint8Array(W * H);
  for (let i = 0; i < wet.length; i++) dry[i] = wet[i] ? 0 : 1;
  const toDry = chamfer(dry, W, H);
  // Signed at cell centres: the edge sits half a tile off the boundary cell's centre.
  const blob = new Float32Array(W * H);
  for (let i = 0; i < blob.length; i++) {
    blob[i] = wet[i] ? -(toDry[i] - 0.5) : (toWet[i] - 0.5);
  }
  return { ribbon, blob, W, H };
}

/** Bilinear sample of the cell-centred blob field at a continuous point. */
function sampleBlob(f: WaterDistField, x: number, y: number): number {
  const { blob, W, H } = f;
  const fx = Math.min(W - 1.001, Math.max(0, x - 0.5));
  const fy = Math.min(H - 1.001, Math.max(0, y - 0.5));
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = fx - x0, ty = fy - y0;
  const i = y0 * W + x0;
  const a = blob[i], b = blob[i + 1] ?? a;
  const c = blob[i + W] ?? a, d = blob[i + W + 1] ?? c;
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}

/** Distance to the ribbon swath edge at a continuous point (+cap when no segment near). */
function ribbonDist(f: WaterDistField, x: number, y: number): number {
  const bin = f.ribbon;
  if (!bin) return WATER_DIST_CAP;
  const bx = Math.min(bin.nbx - 1, Math.max(0, Math.floor(x / bin.bucketTiles)));
  const by = Math.min(bin.nby - 1, Math.max(0, Math.floor(y / bin.bucketTiles)));
  const b = by * bin.nbx + bx;
  let best = WATER_DIST_CAP;
  const s = bin.segments;
  for (let k = bin.bucketOffset[b]; k < bin.bucketOffset[b + 1]; k++) {
    const o = bin.bucketSegs[k] * FEATURE_SEG_STRIDE;
    const { t, d } = segDist(s[o], s[o + 1], s[o + 2], s[o + 3], x, y);
    const half = s[o + 4] + (s[o + 5] - s[o + 4]) * t;
    const sd = d - half;
    if (sd < best) best = sd;
  }
  return best;
}

// Memoised like the mask: the field is static per world; entity sweeps query it per foot.
const distCache = new Map<string, WaterDistField>();
const DIST_CACHE_CAP = 4;

/**
 * The CONTINUOUS render-water signed distance for a map (tiles; negative = under the
 * drawn water, clamped to ±WATER_DIST_CAP). The sub-tile view of the same truth as
 * {@link getRenderWaterMask} — same network, same per-vertex half-widths. Use this for
 * anything with a continuous position (entity feet, placement rolls); use the mask for
 * per-cell work.
 */
export function getRenderWaterDist(map: GameMap): WaterDistance {
  const k = `${map.seed}:${map.width}x${map.height}`;
  let f = distCache.get(k);
  if (!f) {
    f = buildWaterDistField(map);
    distCache.set(k, f);
    if (distCache.size > DIST_CACHE_CAP) {
      const oldest = distCache.keys().next().value;
      if (oldest !== undefined) distCache.delete(oldest);
    }
  }
  const field = f;
  return (x: number, y: number): number => {
    const d = Math.min(sampleBlob(field, x, y), ribbonDist(field, x, y));
    return Math.max(-WATER_DIST_CAP, Math.min(WATER_DIST_CAP, d));
  };
}

/** Drop the memoised distance fields (tests; harmless in prod). */
export function clearRenderWaterDistCache(): void {
  distCache.clear();
}
