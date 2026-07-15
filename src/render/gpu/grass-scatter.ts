// src/render/gpu/grass-scatter.ts
//
// Standing-grass scatter (vegetation-billboard epic, step 1). Generates GPU-only
// upright ground-cover billboard INSTANCES from the terrain heightfield — grass
// tufts / wildflowers / pebbles harvested into `public/textures/clutter/atlas.png`
// (see scripts/slice-clutter-sprites.ts), placed by suitability + CLUMPED by a
// low-frequency density field so flowers gather in patches and rocks in outcrops
// (never the uniform per-cell sprinkle of the flat in-shader scatter).
//
// Instances are WORLD-SCREEN px, pre-camera: the foot point is the terrain surface
// projected to iso screen (height lifts -y), exactly like the terrain vertex shader,
// so the camera transform (uXform) rides in the shader and pan/zoom never re-packs.
// The blade is a vertical, vertically-subdivided ribbon (GRASS_SEGMENTS quads) — the
// subdivision carries no cost yet but is the hinge a later wind/push pass bends. One
// instanced draw per frame; the array is memoised per world (rebuilt on height-array
// identity change), so per-frame cost is just the draw.

import type { TerrainField } from '@/render/gpu/terrain-field';

/** Vertical segments per blade ribbon → 2·(SEG+1) strip verts, SEG·2 triangles.
 *  Subdivision exists so wind/push can bend the planar sprite along its height. */
export const GRASS_SEGMENTS = 4;
export const GRASS_VERTEX_COUNT = 2 * (GRASS_SEGMENTS + 1);

/** Per-instance floats: iA(footX,footY,depth,size) iUV(u0,v0,u1,v1) iP(width,seed,cat,bendK). */
export const GRASS_INSTANCE_FLOATS = 12;
export const GRASS_INSTANCE_STRIDE = GRASS_INSTANCE_FLOATS * 4;

/** Below this camera scale (uXform.sx) the pass is skipped — a full meadow is noise
 *  at overview zoom (and a needless fill cost), like the terrain clutter's clFade. */
export const GRASS_MIN_ZOOM = 0.45;

/** Layer-range map written by the slicer alongside the atlas (data-driven, so a
 *  re-slice with different sprite counts needs no shader/const edit). */
export interface ClutterManifest {
  cell: number;
  cols: number;
  rows: number;
  count: number;
  ranges: Record<ClutterCat, { start: number; count: number }>;
  cats: readonly ClutterCat[];
}

/** Ground-cover sprite categories in the atlas. Land: grass/flower/reed/rock. Coastal
 *  (appended): seaweed (swaying in the shallows) + wrack (shells/driftwood at the tide line). */
export type ClutterCat = 'grass' | 'flower' | 'reed' | 'rock' | 'seaweed' | 'wrack';

const MAX_GRASS = 300_000;         // hard cap — big maps thin out rather than OOM
const MAX_WEED = 80_000;           // seaweed sub-buffer cap (shallow-shelf fringe only)
const PER_TILE = 15;               // scatter attempts per land tile (jittered) — dense carpet
                                   // so the sward reads continuous, not sparse over base ground

/** Deterministic 2D hash in [0,1). Render-only, so a plain sinf hash is fine. */
function hash2(x: number, y: number): number {
  const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return h - Math.floor(h);
}

/** Low-frequency value noise in [0,1] for clumping fields (bilinear over a hash lattice). */
function vnoise(x: number, y: number): number {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash2(x0, y0), b = hash2(x0 + 1, y0);
  const c = hash2(x0, y0 + 1), d = hash2(x0 + 1, y0 + 1);
  return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
}

/** Build the standing-grass instance buffer for one terrain field. Returns the packed
 *  Float32Array (sliced to `count` instances) + the instance count. */
export function buildGrassInstances(
  field: TerrainField, m: ClutterManifest,
): { data: Float32Array; count: number; seaweedCount: number } {
  const { heights, moisture, globals: g } = field;
  const W = g.grid[0] | 0, H = g.grid[1] | 0;
  const halfW = g.half[0], halfH = g.half[1];
  const sea = g.seaLevel, relief = g.reliefM, zPx = g.zPxPerM;
  const atlasW = m.cols * m.cell, atlasH = m.rows * m.cell;

  // Bilinear elevation [0,1] at a continuous tile coord (mirrors heightAtF in the shader).
  const elevAt = (fx: number, fy: number): number => {
    const px = Math.min(Math.max(fx, 0), W - 1), py = Math.min(Math.max(fy, 0), H - 1);
    const x0 = px | 0, y0 = py | 0;
    const x1 = Math.min(x0 + 1, W - 1), y1 = Math.min(y0 + 1, H - 1);
    const tx = px - x0, ty = py - y0;
    const h00 = heights[y0 * W + x0], h10 = heights[y0 * W + x1];
    const h01 = heights[y1 * W + x0], h11 = heights[y1 * W + x1];
    return (h00 + (h10 - h00) * tx) * (1 - ty) + (h01 + (h11 - h01) * tx) * ty;
  };

  // Seaweed is emitted into a SEPARATE buffer so the final array can place it contiguously
  // at the FRONT: the renderer draws that sub-range BEFORE the water pass (no depth write) so
  // the translucent water composites over it (submerged), while land veg + wrack draw AFTER
  // water as before. Seaweed is a thin shallow-shelf fringe, so a smaller cap suffices.
  const land = new Float32Array(MAX_GRASS * GRASS_INSTANCE_FLOATS);
  const weed = new Float32Array(MAX_WEED * GRASS_INSTANCE_FLOATS);
  let nLand = 0, nWeed = 0;

  const cellRect = (layer: number): [number, number, number, number] => {
    const col = layer % m.cols, row = (layer / m.cols) | 0;
    const u0 = (col * m.cell + 0.5) / atlasW, u1 = ((col + 1) * m.cell - 0.5) / atlasW;
    const v0 = (row * m.cell + 0.5) / atlasH, v1 = ((row + 1) * m.cell - 0.5) / atlasH;
    return [u0, v0, u1, v1];
  };
  const pickLayer = (cat: ClutterCat, r: number): number => {
    const rg = m.ranges[cat];
    if (!rg || rg.count === 0) return m.ranges.grass.start; // graceful: fall back to grass
    return rg.start + Math.min(rg.count - 1, (r * rg.count) | 0);
  };

  const CAT_ID: Record<ClutterCat, number> = {
    grass: 0, flower: 1, rock: 2, reed: 3, seaweed: 4, wrack: 5,
  };
  // Pack one billboard instance at tile coord (fx,fy) on the surface at elevation e.
  // Shared by land veg + the coastal seaweed/wrack so placement stays one code path.
  const emit = (
    fx: number, fy: number, e: number, cat: ClutterCat,
    size: number, widthMul: number, bendK: number,
  ): void => {
    const isWeed = cat === 'seaweed';
    if (isWeed ? nWeed >= MAX_WEED : nLand >= MAX_GRASS) return;
    const [u0, v0, u1, v1] = cellRect(pickLayer(cat, hash2(fx * 8.1 + 3.3, fy * 5.9 + 7.7)));
    const hPx = (e - sea) * relief * zPx;           // foot lift (negative below the waterline)
    const footX = (fx - fy) * halfW;
    const footY = (fx + fy) * halfH - hPx;
    const depth = Math.min(0.999, Math.max(0, (fx + fy) / (W + H)));
    const seed = hash2(fx * 12.9 + 2.2, fy * 7.3 + 9.9);
    const buf = isWeed ? weed : land;
    const o = (isWeed ? nWeed : nLand) * GRASS_INSTANCE_FLOATS;
    buf[o] = footX; buf[o + 1] = footY; buf[o + 2] = depth; buf[o + 3] = size;
    buf[o + 4] = u0; buf[o + 5] = v0; buf[o + 6] = u1; buf[o + 7] = v1;
    buf[o + 8] = size * widthMul; buf[o + 9] = seed; buf[o + 10] = CAT_ID[cat]; buf[o + 11] = bendK;
    if (isWeed) nWeed++; else nLand++;
  };

  // Coastal placement bands (metres relative to the water surface).
  const SEAWEED_MIN_DEPTH_M = 0.15;   // just under the surface
  const SEAWEED_MAX_DEPTH_M = 3.5;    // seaweed beds hug the shallow near-shore shelf only
  const WRACK_BAND_M = 1.5;           // the tide line: wet sand just above the water

  for (let ty = 0; ty < H && nLand < MAX_GRASS; ty++) {
    for (let tx = 0; tx < W && nLand < MAX_GRASS; tx++) {
      for (let k = 0; k < PER_TILE && nLand < MAX_GRASS; k++) {
        const jx = hash2(tx * 3.1 + k * 17.3, ty * 2.7 + k * 5.1);
        const jy = hash2(tx * 6.7 + k * 9.2, ty * 4.4 + k * 12.6);
        const fx = tx + jx, fy = ty + jy;
        const e = elevAt(fx, fy);
        const aboveM = (e - sea) * relief;              // metres above the water (negative = submerged)

        // ── SUBMERGED: seaweed beds on the shallow near-shore shelf; deeper water stays bare ──
        if (aboveM <= 0.004) {
          const depthM = -aboveM;
          if (depthM > SEAWEED_MIN_DEPTH_M && depthM < SEAWEED_MAX_DEPTH_M) {
            const weedField = vnoise(fx / 5.0 + 41.3, fy / 5.0 + 17.9);        // clumped into beds
            // Thin out with depth so the shelf edge fades to bare sand, not a hard weed wall.
            const depthFade = 1 - (depthM - SEAWEED_MIN_DEPTH_M) / (SEAWEED_MAX_DEPTH_M - SEAWEED_MIN_DEPTH_M);
            // Density scales WITH the clump field so beds vary — sparse fringes, lush cores
            // ("sometimes the shallows are more vegetated") rather than a uniform carpet.
            const bedDensity = 0.14 + 0.78 * Math.max(0, (weedField - 0.46) / 0.54);
            if (weedField > 0.46 && hash2(fx * 2.1 + 9.7, fy * 3.9 + 4.1) < bedDensity * depthFade) {
              const sJitW = hash2(fx * 2.9 + 1.1, fy * 3.7 + 6.2);
              emit(fx, fy, e, 'seaweed', 22 + 14 * sJitW, 0.9, 0.7);          // flexible frond, current-swayed
            }
          }
          continue;
        }

        // Slope from central differences (same frame as the terrain normal).
        const hL = elevAt(fx - 1, fy), hR = elevAt(fx + 1, fy);
        const hU = elevAt(fx, fy - 1), hD = elevAt(fx, fy + 1);
        const dx = (hR - hL) * 0.5 * relief * zPx, dz = (hD - hU) * 0.5 * relief * zPx;
        const normY = halfH / Math.sqrt(dx * dx + halfH * halfH + dz * dz);
        const slope = 1 - normY;                        // 0 flat .. →1 cliff

        const moist = moisture[Math.min(H - 1, ty) * W + Math.min(W - 1, tx)] ?? 0.5;
        const rr = hash2(fx * 1.7, fy * 2.3);
        const sJit = hash2(fx * 2.9 + 1.1, fy * 3.7 + 6.2);

        // ── WRACK: the tide line — shells / driftwood / dried weed on the wet sand just above
        //    the water. Densest right at the waterline, thinning up the beach — the strandline
        //    that breaks the sterile sand strip. Occupies this attempt instead of land veg.
        if (aboveM < WRACK_BAND_M) {
          const wrackField = vnoise(fx / 4.0 + 61.7, fy / 4.0 + 88.3);
          const nearLine = 1 - aboveM / WRACK_BAND_M;                     // 1 at the water → 0 up the beach
          if (wrackField > 0.42 && hash2(fx * 3.3 + 12.1, fy * 1.9 + 7.7) < 0.85 * nearLine) {
            emit(fx, fy, e, 'wrack', 10 + 7 * sJit, 1.25, 0.0);          // small flat shell/debris, static
            continue;
          }
        }

        // Clumping fields — low-frequency, so a category gathers into patches/outcrops.
        const flowerField = vnoise(fx / 5.5 + 11.2, fy / 5.5 + 4.7);
        const rockField = vnoise(fx / 4.0 + 31.7, fy / 4.0 + 19.3);
        const boulderField = vnoise(fx / 6.5 + 51.3, fy / 6.5 + 61.9); // big-rock clusters on flat grass
        const reedField = vnoise(fx / 4.5 + 71.1, fy / 4.5 + 23.4);    // reed beds hugging the water
        const nearWater = e < sea + 0.02;                              // TIGHT wet-shore band only (a low
                                                                       // island would otherwise carpet reeds inland)

        let cat: ClutterCat;
        let boulder = false, pebble = false;
        const pebbleField = vnoise(fx / 3.5 + 5.5, fy / 3.5 + 88.1);                   // dusty-ground pebble clumps
        if (slope > 0.55) { if (rr > 0.5) continue; cat = 'rock'; }                    // steep: sparse rock only
        else if (slope > 0.28 && rockField > 0.50) { cat = 'rock'; boulder = rockField > 0.70; } // outcrop, big at core
        else if (boulderField > 0.80 && rr > 0.55) { cat = 'rock'; boulder = true; }   // boulder cluster on flat grass
        else if (nearWater && moist > 0.48 && reedField > 0.50) cat = 'reed';          // tall stiff reeds at the water's edge
        else if (moist < 0.55 && pebbleField > 0.68 && rr > 0.72) { cat = 'rock'; pebble = true; } // tiny strewn pebbles on drier/worn ground
        else if (moist > 0.30 && flowerField > 0.58) cat = 'flower';                   // more, wider-spread flower clumps
        else cat = 'grass';                                                            // grass is the dense default (full carpet)

        // Per-instance size (world px) + wind stiffness by category (bendK, the 12th float):
        // grass floppy (occasional TALL hero tuft), flowers stiffer with bigger blooms, REEDS
        // tall + STIFF (near-square billboard — the sprite's own alpha gives the narrow
        // stalks), tiny strewn PEBBLES, larger clustered BOULDERS — all stone rigid.
        if (cat === 'rock') {
          if (pebble) emit(fx, fy, e, 'rock', 6 + 6 * sJit, 1.2, 0.0);          // tiny scattered pebble
          else if (boulder) emit(fx, fy, e, 'rock', 30 + 18 * sJit, 1.25, 0.0); // hero boulder, clustered
          else emit(fx, fy, e, 'rock', 14 + 7 * sJit, 1.15, 0.0);               // mid fieldstone
        } else if (cat === 'reed') {
          emit(fx, fy, e, 'reed', 52 + 20 * sJit, 0.95, 0.85);                  // tall stiff reed at the water's edge
        } else if (cat === 'flower') {
          emit(fx, fy, e, 'flower', 28 + 10 * sJit, 0.9, 0.55);                 // a bloom on a stalk only nods
        } else {
          const tall = hash2(fx * 4.3 + 5.5, fy * 9.1 + 2.2);                   // hero-tuft field
          emit(fx, fy, e, 'grass', (tall > 0.74 ? 29 : 23) * (0.85 + 0.4 * sJit), 0.85, 0.12);
        }
      }
    }
  }
  // Concatenate with SEAWEED FIRST so the renderer can draw instances [0, seaweedCount) as
  // the pre-water submerged sub-pass and [seaweedCount, count) as the over-water land pass.
  const count = nWeed + nLand;
  const data = new Float32Array(count * GRASS_INSTANCE_FLOATS);
  data.set(weed.subarray(0, nWeed * GRASS_INSTANCE_FLOATS), 0);
  data.set(land.subarray(0, nLand * GRASS_INSTANCE_FLOATS), nWeed * GRASS_INSTANCE_FLOATS);
  return { data, count, seaweedCount: nWeed };
}
