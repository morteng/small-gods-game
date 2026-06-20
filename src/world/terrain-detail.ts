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
//      decides WHERE detail is worth spending: near the waterline, on river cells,
//      near roads, and on steep slopes; dilated for margin, then tiled into the
//      rectangular patch regions the GPU instances.
//
// No GPU/DOM here; everything is unit-testable.

import type { GameMap } from '@/core/types';
import { WaterType } from '@/core/types';
import {
  getHeightfield, baseElevationSamplerFor, ELEVATION_SEA_LEVEL,
} from '@/world/heightfield';
import { styledIslandSpec } from '@/terrain/island-mask';
import { getWorldDeformationStore } from '@/world/road-deformation';
import { heightAt, baseHeightAt } from '@/world/terrain-deformation';
import { getHydrologyResult } from '@/world/hydrology-store';
import { worldStyleOf } from '@/core/world-style';
import { curveRenderElev } from '@/render/gpu/terrain-field';

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

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

    // 3. Sharp analytic carve (roads + river incision), re-sampled continuously.
    //    heightAt − baseHeightAt cancels the floored base, leaving the brush's
    //    continuous metre delta; normalise to the [0,1] elevation space.
    const carveN = (heightAt(map, store, px, py) - baseHeightAt(map, px, py)) / relief;

    const e = clamp01(smooth + residual + carveN);
    return curveRenderElev(e, sea, gamma);
  };
}

export interface DetailMaskOpts {
  /** Normalised-elevation half-band around the waterline that counts as coast. */
  coastBand?: number;
  /** Coarse-gradient magnitude (sum of |∂x|,|∂y| over one tile) above which a cell
   *  counts as steep enough to want finer geometry. */
  slopeThresh?: number;
  /** Tiles either side of a road centreline to flag as carve. */
  roadRadius?: number;
}

/**
 * The cheap importance map: per coarse tile, 1 where sub-tile detail is worth
 * spending — near the waterline (crisp shores), on river cells + near roads (sharp
 * carve), and on steep ground (mountain relief). Dilated by one tile so patches
 * have margin around the feature. Row-major `Uint8Array[W*H]`, deterministic.
 */
export function computeDetailMask(map: GameMap, opts: DetailMaskOpts = {}): Uint8Array {
  const W = map.width, H = map.height;
  const coastBand = opts.coastBand ?? 0.04;
  const slopeThresh = opts.slopeThresh ?? 0.05;
  const roadRadius = opts.roadRadius ?? 1;
  const sea = ELEVATION_SEA_LEVEL;

  const eroded = getHeightfield(
    map.seed, W, H, styledIslandSpec(map.worldSeed), map.worldSeed?.pois ?? null,
  );
  const waterType = getHydrologyResult(map).waterType;

  const raw = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = y * W + x;
      const e = eroded[idx];
      let hot = Math.abs(e - sea) < coastBand;                 // coastline band
      if (!hot && waterType[idx] === WaterType.River) hot = true; // river carve
      if (!hot) {
        const xl = Math.max(0, x - 1), xr = Math.min(W - 1, x + 1);
        const yu = Math.max(0, y - 1), yd = Math.min(H - 1, y + 1);
        const gx = Math.abs(eroded[y * W + xr] - eroded[y * W + xl]);
        const gy = Math.abs(eroded[yd * W + x] - eroded[yu * W + x]);
        if (gx + gy > slopeThresh) hot = true;                 // steep slope
      }
      if (hot) raw[idx] = 1;
    }
  }

  // Roads: stamp a corridor around each edge's polyline (sharp grade-cut banks).
  if (map.roadGraph) {
    for (const edge of map.roadGraph.edges) {
      const pts = edge.polyline;
      if (!pts || pts.length < 1) continue;
      for (const p of pts) {
        const cx = Math.round(p.x), cy = Math.round(p.y);
        for (let dy = -roadRadius; dy <= roadRadius; dy++) {
          for (let dx = -roadRadius; dx <= roadRadius; dx++) {
            const nx = cx + dx, ny = cy + dy;
            if (nx >= 0 && nx < W && ny >= 0 && ny < H) raw[ny * W + nx] = 1;
          }
        }
      }
    }
  }

  // Dilate by one tile (8-neighbour) so a patch covers the feature with margin.
  const mask = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!raw[y * W + x]) continue;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && nx < W && ny >= 0 && ny < H) mask[ny * W + nx] = 1;
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
