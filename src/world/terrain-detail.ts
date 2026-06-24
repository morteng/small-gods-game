// src/world/terrain-detail.ts
//
// Sub-tile terrain DETAIL — the CPU half of the adaptive detail-patch renderer.
// The coarse terrain mesh draws one quad per tile from the row-major height
// buffer; that is flat-faceted at the tile grid. This module supplies GENUINE
// sub-tile relief (not bilinear mush) so the GPU can overlay a finer mesh only
// where it pays off (coastlines, river/road carves, steep ground).
//
// Two pieces, both pure + deterministic from (seed, dims):
//   1. `makeDetailElevSampler(map)` — the render elevation at any CONTINUOUS tile
//      coordinate, reconstructed as
//          bilinear(eroded base)            — the smooth coarse shape
//        + base-noise residual              — TRUE sub-tile relief (analytic noise
//                                             re-evaluated at the fractional coord,
//                                             minus what bilinear already carried)
//        + analytic carve delta             — sharp river/road incision, re-sampled
//                                             at the fractional coord (the brushes
//                                             are continuous, so banks stay crisp)
//      then the world's render-height curve. At INTEGER coords the residual is 0
//      and the carve equals the coarse composed delta, so it is byte-identical to
//      the coarse height buffer — patches seam perfectly to the coarse grid.
//   2. `computeDetailMask` / `coalescePatches` — the cheap importance map that
//      decides WHERE detail is worth spending: on river/lake carves and along road
//      corridors; dilated for margin, then tiled into the rectangular patch regions
//      the GPU instances. (Steep-slope flagging is a noted follow-up.)
//
// No GPU/DOM here; everything is unit-testable.

import type { GameMap } from '@/core/types';
import { WaterType } from '@/core/types';
import { fbm } from '@/core/noise';
import {
  getHeightfield, baseElevationSamplerFor, ELEVATION_SEA_LEVEL,
} from '@/world/heightfield';
import { styledIslandSpec } from '@/terrain/island-mask';
import { getWorldDeformationStore, buildRoadDeformations } from '@/world/road-deformation';
import { heightAt, baseHeightAt } from '@/world/terrain-deformation';
import { worldStyleOf } from '@/core/world-style';
import { curveRenderElev } from '@/render/gpu/terrain-field';
import { buildRenderWaterTypeMemo } from '@/render/gpu/render-water-mask';
import { clamp01 } from '@/core/math';

const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

// High-frequency DETAIL octaves — the terrain's own fBm continued past what the
// coarse one-sample-per-tile grid can represent. The base elevation noise is
// near-tile-Nyquist (adjacent tiles already highly correlated), so simply
// re-evaluating it sub-tile reveals almost nothing; this ADDS genuine sub-tile
// relief at a higher frequency. Applied as a bilinear RESIDUAL (the value minus
// the bilinear of its integer corners) so it is exactly zero at integer tile
// coords — the patch still seams perfectly to the coarse mesh, gaining micro-relief
// only in the cell interiors. Frequency in cycles/tile; amplitude in normalised
// elevation (× mountainRelief metres).
const DETAIL_FREQ = 0.5;
const DETAIL_AMP = 0.018;

/** Bilinear sample of a row-major `Float32Array[W*H]` at a fractional coord. */
function bilin(arr: Float32Array, W: number, H: number, fx: number, fy: number): number {
  const px = fx < 0 ? 0 : fx > W - 1 ? W - 1 : fx;
  const py = fy < 0 ? 0 : fy > H - 1 ? H - 1 : fy;
  const x0 = Math.floor(px), y0 = Math.floor(py);
  const x1 = Math.min(x0 + 1, W - 1), y1 = Math.min(y0 + 1, H - 1);
  const tx = px - x0, ty = py - y0;
  const h00 = arr[y0 * W + x0], h10 = arr[y0 * W + x1];
  const h01 = arr[y1 * W + x0], h11 = arr[y1 * W + x1];
  return mix(mix(h00, h10, tx), mix(h01, h11, tx), ty);
}

/**
 * Build the sub-tile render-elevation sampler for a world. Captures the (memoised)
 * coarse fields once; the returned closure is cheap per sample, so the GPU bake can
 * fill thousands of fine vertices. Returns NORMALISED render elevation in `[0,1]`
 * (the same space the coarse height buffer carries — post deformation, post curve).
 */
export function makeDetailElevSampler(map: GameMap): (fx: number, fy: number) => number {
  const W = map.width, H = map.height;
  const eroded = getHeightfield(
    map.seed, W, H, styledIslandSpec(map.worldSeed), map.worldSeed?.pois ?? null,
  );
  const baseCont = baseElevationSamplerFor(map);
  const store = getWorldDeformationStore(map);
  const style = worldStyleOf(map.worldSeed);
  const relief = style.mountainRelief || 1;
  const gamma = style.terrainHeightGamma;
  const sea = ELEVATION_SEA_LEVEL;

  return (fx: number, fy: number): number => {
    // 1. Smooth coarse shape (eroded + POI), bilinear.
    const smooth = bilin(eroded, W, H, fx, fy);

    // 2. TRUE sub-tile relief: analytic base noise at the fractional coord, minus
    //    the bilinear of that same noise at the surrounding integer cells — i.e.
    //    exactly the high-frequency structure bilinear discards. Zero at integers.
    const px = fx < 0 ? 0 : fx > W - 1 ? W - 1 : fx;
    const py = fy < 0 ? 0 : fy > H - 1 ? H - 1 : fy;
    const x0 = Math.floor(px), y0 = Math.floor(py);
    const x1 = Math.min(x0 + 1, W - 1), y1 = Math.min(y0 + 1, H - 1);
    const tx = px - x0, ty = py - y0;
    const baseBilin = mix(
      mix(baseCont(x0, y0), baseCont(x1, y0), tx),
      mix(baseCont(x0, y1), baseCont(x1, y1), tx),
      ty,
    );
    const residual = baseCont(px, py) - baseBilin;

    // High-frequency detail octave (continues the fBm past the coarse grid), as a
    // bilinear residual so it is zero at integer coords (perfect seam) and adds
    // genuine sub-tile micro-relief only inside the cells.
    const det = (gx: number, gy: number): number =>
      fbm(gx * DETAIL_FREQ, gy * DETAIL_FREQ, { seed: map.seed + 4096, octaves: 3 });
    const detBilin = mix(
      mix(det(x0, y0), det(x1, y0), tx),
      mix(det(x0, y1), det(x1, y1), tx),
      ty,
    );
    const detail = (det(px, py) - detBilin) * DETAIL_AMP;

    // 3. Sharp analytic carve (roads + river incision), re-sampled continuously.
    //    heightAt − baseHeightAt cancels the floored base, leaving the brush's
    //    continuous metre delta; normalise to the [0,1] elevation space.
    const carveN = (heightAt(map, store, px, py) - baseHeightAt(map, px, py)) / relief;

    const e = clamp01(smooth + residual + detail + carveN);
    return curveRenderElev(e, sea, gamma);
  };
}

export interface DetailMaskOpts {
  /** Tiles of margin stamped around each river/lake cell, so the carved BANKS get
   *  the fine mesh too (the carve brush spreads a couple tiles past the channel). */
  bankRadius?: number;
  /** The RENDER water classification to flag (smooth connectome rivers + lake bodies,
   *  including author-placed lakes). Defaults to the memoised render waterType — NOT
   *  the raw D8 raster — so the fine mesh follows the smooth carved channel the
   *  renderer actually draws, not the 90° drainage staircase. Pass the edited net's
   *  classification (studio) to give a placed lake fine banks. */
  waterType?: Uint8Array;
  /** Tiles of margin stamped around each road-carved cell, so the graded SHOULDERS
   *  (where the grade-cut transitions back to natural ground — the sharpest slope)
   *  get the fine mesh too. Defaults to 1. Set < 0 to opt out of road detail. */
  roadRadius?: number;
}

/**
 * The importance map: 1 where a river channel / lake basin OR a road corridor carves
 * the terrain — those beds + banks + road shoulders are the cells whose sharp
 * incision needs the sub-tile mesh. Everything else (coasts, slopes, plains) rides the
 * coarse one-quad-per-tile grid, so the detail patches stay sparse (a thin corridor
 * along each river + a ring around each lake + a ribbon along each road) and cheap.
 * Each carve cell is dilated by `bankRadius` (water) / `roadRadius` (roads) tiles.
 * Row-major `Uint8Array[W*H]`, deterministic.
 *
 * Water keys off the RENDER classification (smooth connectome rivers + lake bodies),
 * NOT the raw D8 raster: the carve follows the smooth centreline, so the fine mesh
 * must follow it too — that is what de-jags diagonal rivers and gives connectome /
 * author-placed lakes their fine banks. Roads key off the SAME corridor deformations
 * the renderer lifts (`buildRoadDeformations`), so the fine mesh follows the smoothed
 * road centreline and resolves the grade-cut + cross-section (camber/gutter/ditch/ruts)
 * that otherwise facets on the coarse grid.
 */
export function computeDetailMask(map: GameMap, opts: DetailMaskOpts = {}): Uint8Array {
  const W = map.width, H = map.height;
  const bankRadius = opts.bankRadius ?? 2;
  const roadRadius = opts.roadRadius ?? 1;
  const waterType = opts.waterType ?? buildRenderWaterTypeMemo(map);

  const mask = new Uint8Array(W * H);

  // Stamp a (2r+1)² block around a hot cell, clipped to bounds.
  const dilate = (cx: number, cy: number, r: number): void => {
    for (let dy = -r; dy <= r; dy++) {
      const ny = cy + dy;
      if (ny < 0 || ny >= H) continue;
      for (let dx = -r; dx <= r; dx++) {
        const nx = cx + dx;
        if (nx >= 0 && nx < W) mask[ny * W + nx] = 1;
      }
    }
  };

  // 1. Water carves — river channels + lake basins + their banks.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const wt = waterType[y * W + x];
      if (wt !== WaterType.River && wt !== WaterType.Lake) continue;
      dilate(x, y, bankRadius);
    }
  }

  // 2. Road carves — the corridor deformations roads write into the shared channel
  //    (carriageway + graded shoulders). Walk each road brush over its own footprint
  //    only (bounded by the corridor AABB, not the whole map) so this stays cheap.
  if (roadRadius >= 0 && map.roadGraph) {
    for (const def of buildRoadDeformations(map, map.roadGraph)) {
      const x0 = Math.max(0, Math.floor(def.bounds.minX));
      const y0 = Math.max(0, Math.floor(def.bounds.minY));
      const x1 = Math.min(W - 1, Math.ceil(def.bounds.maxX));
      const y1 = Math.min(H - 1, Math.ceil(def.bounds.maxY));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          if (def.mask(x, y) > 0) dilate(x, y, roadRadius);
        }
      }
    }
  }

  return mask;
}

/** A rectangular detail patch in tile space (inclusive origin, tile extent). */
export interface DetailPatch { ox: number; oy: number; w: number; h: number; }

/**
 * Tile the map into `patchTiles`×`patchTiles` blocks and emit a patch for every
 * block that contains at least one hot cell. Block tiling (rather than tight rects)
 * keeps the GPU instance layout uniform — every patch is the same fine-grid size —
 * while still skipping the flat ocean/plains interior entirely.
 */
export function coalescePatches(
  mask: Uint8Array, W: number, H: number, patchTiles = 16,
): DetailPatch[] {
  const out: DetailPatch[] = [];
  for (let by = 0; by < H; by += patchTiles) {
    for (let bx = 0; bx < W; bx += patchTiles) {
      const w = Math.min(patchTiles, W - bx);
      const h = Math.min(patchTiles, H - by);
      let active = false;
      for (let y = by; y < by + h && !active; y++) {
        for (let x = bx; x < bx + w; x++) {
          if (mask[y * W + x]) { active = true; break; }
        }
      }
      if (active) out.push({ ox: bx, oy: by, w, h });
    }
  }
  return out;
}
