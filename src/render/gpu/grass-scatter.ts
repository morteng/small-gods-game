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
  ranges: Record<'grass' | 'flower' | 'reed' | 'rock', { start: number; count: number }>;
  cats: readonly ('grass' | 'flower' | 'reed' | 'rock')[];
}

const MAX_GRASS = 300_000;         // hard cap — big maps thin out rather than OOM
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
): { data: Float32Array; count: number } {
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

  const out = new Float32Array(MAX_GRASS * GRASS_INSTANCE_FLOATS);
  let n = 0;

  const cellRect = (layer: number): [number, number, number, number] => {
    const col = layer % m.cols, row = (layer / m.cols) | 0;
    const u0 = (col * m.cell + 0.5) / atlasW, u1 = ((col + 1) * m.cell - 0.5) / atlasW;
    const v0 = (row * m.cell + 0.5) / atlasH, v1 = ((row + 1) * m.cell - 0.5) / atlasH;
    return [u0, v0, u1, v1];
  };
  const pickLayer = (cat: 'grass' | 'flower' | 'reed' | 'rock', r: number): number => {
    const rg = m.ranges[cat];
    if (!rg || rg.count === 0) return m.ranges.grass.start; // graceful: fall back to grass
    return rg.start + Math.min(rg.count - 1, (r * rg.count) | 0);
  };

  for (let ty = 0; ty < H && n < MAX_GRASS; ty++) {
    for (let tx = 0; tx < W && n < MAX_GRASS; tx++) {
      for (let k = 0; k < PER_TILE && n < MAX_GRASS; k++) {
        const jx = hash2(tx * 3.1 + k * 17.3, ty * 2.7 + k * 5.1);
        const jy = hash2(tx * 6.7 + k * 9.2, ty * 4.4 + k * 12.6);
        const fx = tx + jx, fy = ty + jy;
        const e = elevAt(fx, fy);
        if (e <= sea + 0.002) continue;                 // underwater / beach line → bare

        // Slope from central differences (same frame as the terrain normal).
        const hL = elevAt(fx - 1, fy), hR = elevAt(fx + 1, fy);
        const hU = elevAt(fx, fy - 1), hD = elevAt(fx, fy + 1);
        const dx = (hR - hL) * 0.5 * relief * zPx, dz = (hD - hU) * 0.5 * relief * zPx;
        const normY = halfH / Math.sqrt(dx * dx + halfH * halfH + dz * dz);
        const slope = 1 - normY;                        // 0 flat .. →1 cliff

        const moist = moisture[Math.min(H - 1, ty) * W + Math.min(W - 1, tx)] ?? 0.5;
        const rr = hash2(fx * 1.7, fy * 2.3);

        // Clumping fields — low-frequency, so a category gathers into patches/outcrops.
        const flowerField = vnoise(fx / 5.5 + 11.2, fy / 5.5 + 4.7);
        const rockField = vnoise(fx / 4.0 + 31.7, fy / 4.0 + 19.3);
        const boulderField = vnoise(fx / 6.5 + 51.3, fy / 6.5 + 61.9); // big-rock clusters on flat grass
        const reedField = vnoise(fx / 4.5 + 71.1, fy / 4.5 + 23.4);    // reed beds hugging the water
        const nearWater = e < sea + 0.02;                              // TIGHT wet-shore band only (a low
                                                                       // island would otherwise carpet reeds inland)

        let cat: 'grass' | 'flower' | 'rock' | 'reed';
        let boulder = false, pebble = false;
        const pebbleField = vnoise(fx / 3.5 + 5.5, fy / 3.5 + 88.1);                   // dusty-ground pebble clumps
        if (slope > 0.55) { if (rr > 0.5) continue; cat = 'rock'; }                    // steep: sparse rock only
        else if (slope > 0.28 && rockField > 0.50) { cat = 'rock'; boulder = rockField > 0.70; } // outcrop, big at core
        else if (boulderField > 0.80 && rr > 0.55) { cat = 'rock'; boulder = true; }   // boulder cluster on flat grass
        else if (nearWater && moist > 0.48 && reedField > 0.50) cat = 'reed';          // tall stiff reeds at the water's edge
        else if (moist < 0.55 && pebbleField > 0.68 && rr > 0.72) { cat = 'rock'; pebble = true; } // tiny strewn pebbles on drier/worn ground
        else if (moist > 0.30 && flowerField > 0.58) cat = 'flower';                   // more, wider-spread flower clumps
        else cat = 'grass';                                                            // grass is the dense default (full carpet)

        const layer = pickLayer(cat, hash2(fx * 8.1 + 3.3, fy * 5.9 + 7.7));
        const [u0, v0, u1, v1] = cellRect(layer);

        // World-screen foot (pre-camera); height lifts -y like the terrain VS.
        const hPx = (e - sea) * relief * zPx;
        const footX = (fx - fy) * halfW;
        const footY = (fx + fy) * halfH - hPx;
        const depth = Math.min(0.999, Math.max(0, (fx + fy) / (W + H)));

        // Per-instance size (world px) + wind stiffness by category (bendK, the 12th float):
        // grass floppy (occasional TALL hero tuft), flowers stiffer with bigger blooms, REEDS
        // tall + STIFF (near-square billboard — the sprite's own alpha gives the narrow
        // stalks), tiny strewn PEBBLES, larger clustered BOULDERS — all stone rigid.
        const sJit = hash2(fx * 2.9 + 1.1, fy * 3.7 + 6.2);
        let base: number, widthMul: number, bendK: number, catId: number;
        if (cat === 'rock') {
          if (pebble) { base = 6 + 6 * sJit; widthMul = 1.2; }         // tiny scattered pebble
          else if (boulder) { base = 30 + 18 * sJit; widthMul = 1.25; } // hero boulder, clustered
          else { base = 14 + 7 * sJit; widthMul = 1.15; }              // mid fieldstone
          bendK = 0.0; catId = 2;
        } else if (cat === 'reed') {
          base = 52 + 20 * sJit; widthMul = 0.95; bendK = 0.85; catId = 3;   // real reed sprite: near-square billboard
        } else if (cat === 'flower') {
          base = 28 + 10 * sJit; widthMul = 0.9; bendK = 0.55; catId = 1;  // stiffer: a bloom on a stalk only nods, never smears
        } else {
          const tall = hash2(fx * 4.3 + 5.5, fy * 9.1 + 2.2);         // hero-tuft field
          base = (tall > 0.74 ? 29 : 23) * (0.85 + 0.4 * sJit);       // some blades stand taller (not so tall they streak)
          widthMul = 0.85; bendK = 0.12; catId = 0;
        }
        const size = base;
        const width = size * widthMul;
        const seed = hash2(fx * 12.9 + 2.2, fy * 7.3 + 9.9);

        const o = n * GRASS_INSTANCE_FLOATS;
        out[o] = footX; out[o + 1] = footY; out[o + 2] = depth; out[o + 3] = size;
        out[o + 4] = u0; out[o + 5] = v0; out[o + 6] = u1; out[o + 7] = v1;
        out[o + 8] = width; out[o + 9] = seed; out[o + 10] = catId; out[o + 11] = bendK;
        n++;
      }
    }
  }
  return { data: out.subarray(0, n * GRASS_INSTANCE_FLOATS), count: n };
}
