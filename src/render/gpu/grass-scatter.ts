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
import { computeSnow01, type SnowFields } from '@/render/snow-mask';

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
 *  (appended): seaweed (swaying in the shallows) + wrack (shells/driftwood at the tide line).
 *  Aquatic (appended): lilypad — a FLAT pad floating ON calm fresh water (foot at the water
 *  surface, drawn in the post-water pass; the shader lays the quad on the iso ground plane). */
export type ClutterCat = 'grass' | 'flower' | 'reed' | 'rock' | 'seaweed' | 'wrack' | 'lilypad';

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
  waterSurf: Float32Array | null = null, waterType: Uint32Array | null = null,
): { data: Float32Array; count: number; seaweedCount: number } {
  const { heights, moisture, temperature, globals: g } = field;
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
  // Cap handling: `want*` counts every requested emission (incl. past the cap). When a
  // scan overflows, it is RERUN with `keep*` thinning (a deterministic per-sample hash
  // test) so the carpet thins UNIFORMLY across the whole map — never truncating at a
  // row: the old early-break filled the buffer top-down and left everything south of
  // ~row 60 of a big map completely bare ("thin out", the intent, not "cut off").
  let wantLand = 0, wantWeed = 0;
  let keepLand = 1, keepWeed = 1;

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
    grass: 0, flower: 1, rock: 2, reed: 3, seaweed: 4, wrack: 5, lilypad: 6,
  };
  // Pack one billboard instance at tile coord (fx,fy) on the surface at elevation e.
  // Shared by land veg + the coastal seaweed/wrack so placement stays one code path.
  const emit = (
    fx: number, fy: number, e: number, cat: ClutterCat,
    size: number, widthMul: number, bendK: number,
  ): void => {
    const isWeed = cat === 'seaweed';
    if (isWeed) wantWeed++; else wantLand++;
    const keep = isWeed ? keepWeed : keepLand;
    if (keep < 1 && hash2(fx * 9.7 + 4.9, fy * 6.1 + 8.3) >= keep) return;
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

  // FRESHWATER submerged band (river/lake beds) — shallower than the marine shelf: waterweed
  // roots in the top ~2 m of a channel/pool, keyed on the LOCAL water surface (below) so an
  // inland river above sea level still reads as a living bed. Only usable when the water
  // fields align cell-for-cell with the height grid (same super-sample); else skip safely.
  const FRESH_WEED_MIN_DEPTH_M = 0.10;
  const FRESH_WEED_MAX_DEPTH_M = 2.20;
  const freshOk = !!waterSurf && !!waterType && waterSurf.length === W * H;

  // SNOW: land clutter is not emitted where the terrain shader paints snow cover —
  // the billboards carry bare-ground colours (green tufts, grey-brown fieldstone)
  // and have no snow shading of their own, so on a white field they read as pasted
  // on top of the snow rather than under it. Same kernel + threshold as the
  // draw-list's ground-cover hide (GROUND_COVER_SNOW_HIDE, entity-draw-list.ts);
  // submerged categories (seaweed/waterweed/lilypad) are unaffected — they live
  // under liquid water. Static per world, like the rest of the scatter.
  const SNOW_CLUTTER_HIDE = 0.2;
  const snowFields: SnowFields = {
    heights, temperature, width: W, height: H, reliefM: relief, zPxPerM: zPx,
  };

  // LILY PADS — flat pads floating ON calm fresh water. A pad roots in the bed, so it
  // keeps the waterweed's shallow depth band, but it RENDERS at the water surface: the
  // instance foot is the LOCAL surface elevation (not the bed), and the pad goes into
  // the LAND buffer so it draws AFTER the water pass, sitting on top of it. Calm water
  // only — pads grow on lakes and slack pools and are torn off anything with current,
  // so any water-surface gradient at all disqualifies the cell (the riparian reeds'
  // calm² rule, taken to its limit for a floating leaf).
  const LILY_MIN_DEPTH_M = 0.20;
  const LILY_MAX_DEPTH_M = 2.00;
  const LILY_CALM_MAX_M = 0.05;      // max |surface drop| to any wet N4 neighbour (m/tile)
  // Largest |water-surface step| (metres per tile) from cell (cx,cy) to its wet N4
  // neighbours — 0 on a lake, >0 anywhere the river actually descends.
  const surfDropM = (cx: number, cy: number): number => {
    const c = waterSurf![cy * W + cx];
    if (c < 0) return Infinity;
    let d = 0;
    if (cx > 0) { const n = waterSurf![cy * W + cx - 1]; if (n >= 0) d = Math.max(d, Math.abs(c - n)); }
    if (cx < W - 1) { const n = waterSurf![cy * W + cx + 1]; if (n >= 0) d = Math.max(d, Math.abs(c - n)); }
    if (cy > 0) { const n = waterSurf![(cy - 1) * W + cx]; if (n >= 0) d = Math.max(d, Math.abs(c - n)); }
    if (cy < H - 1) { const n = waterSurf![(cy + 1) * W + cx]; if (n >= 0) d = Math.max(d, Math.abs(c - n)); }
    return d * relief;
  };

  const scan = (): void => {
  for (let ty = 0; ty < H; ty++) {
    for (let tx = 0; tx < W; tx++) {
      const snowT = computeSnow01(snowFields, tx, ty);
      for (let k = 0; k < PER_TILE; k++) {
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

        // ── FRESHWATER SUBMERGED: waterweed on a river/lake bed, keyed on the LOCAL water
        //    surface (not the global sea) so an inland channel above sea level still grows a
        //    living bed. Drawn as seaweed-category into the pre-water sub-pass so the real
        //    translucent water composites over it — the ocean's shelf treatment, for rivers. ──
        if (freshOk) {
          const ci = Math.min(H - 1, ty) * W + Math.min(W - 1, tx);
          const wt = waterType![ci];
          if (wt === 2 || wt === 3) {                       // WaterType.Lake | WaterType.River
            const sw = waterSurf![ci];
            const submM = sw > 0 ? (sw - e) * relief : -1;  // metres below the local surface
            if (submM > 0) {                                // this sample sits under the water
              // ── LILY PADS: flat pads ON the surface of calm, shallow fresh water —
              //    clumped into colonies, emitted at the SURFACE elevation into the land
              //    buffer (drawn after the water composites). A pad sample never also
              //    grows waterweed under itself; the bed stays visible between colonies. ──
              if (submM > LILY_MIN_DEPTH_M && submM < LILY_MAX_DEPTH_M) {
                const padField = vnoise(fx / 3.5 + 91.7, fy / 3.5 + 47.3);   // clumped colonies
                if (padField > 0.56 && hash2(fx * 4.1 + 8.3, fy * 2.7 + 15.9) < 0.60 &&
                    surfDropM(Math.min(W - 1, tx), Math.min(H - 1, ty)) < LILY_CALM_MAX_M) {
                  const sJitP = hash2(fx * 2.9 + 1.1, fy * 3.7 + 6.2);
                  emit(fx, fy, sw, 'lilypad', 6 + 9 * sJitP, 1.0, 0.0);      // flat floating pad
                  continue;
                }
              }
              if (submM > FRESH_WEED_MIN_DEPTH_M && submM < FRESH_WEED_MAX_DEPTH_M) {
                const weedField = vnoise(fx / 4.0 + 33.7, fy / 4.0 + 12.1);   // clumped beds
                if (weedField > 0.44 && hash2(fx * 2.3 + 5.1, fy * 3.1 + 2.7) < 0.55) {
                  const sJitW = hash2(fx * 2.9 + 1.1, fy * 3.7 + 6.2);
                  emit(fx, fy, e, 'seaweed', 16 + 12 * sJitW, 0.8, 0.7);      // submerged frond, current-swayed
                }
              }
              continue;   // a submerged fresh-water sample carries no land veg
            }
          }
        }

        // Snow-covered ground carries NO land clutter (see SNOW_CLUTTER_HIDE above) —
        // checked after the submerged branches so underwater categories still grow.
        if (snowT >= SNOW_CLUTTER_HIDE) continue;

        // Slope from central differences (same frame as the terrain normal).
        const hL = elevAt(fx - 1, fy), hR = elevAt(fx + 1, fy);
        const hU = elevAt(fx, fy - 1), hD = elevAt(fx, fy + 1);
        const dx = (hR - hL) * 0.5 * relief * zPx, dz = (hD - hU) * 0.5 * relief * zPx;
        const normY = halfH / Math.sqrt(dx * dx + halfH * halfH + dz * dz);
        const slope = 1 - normY;                        // 0 flat .. →1 cliff

        const mIdx = Math.min(H - 1, ty) * W + Math.min(W - 1, tx);
        const moist = moisture[mIdx] ?? 0.5;
        const temp = temperature[mIdx] ?? 0.5;
        const rr = hash2(fx * 1.7, fy * 2.3);
        const sJit = hash2(fx * 2.9 + 1.1, fy * 3.7 + 6.2);

        // ARIDITY THINNING: hot, dry ground carries sparse xerophytic scrub, not a meadow —
        // grass cover falls toward bare dune/hardpan as moisture drops, mirroring the terrain
        // splat that already turns arid there (before this the billboard grass carpeted a
        // desert bright green, fighting the sand). Heat sharpens it: a hot desert is barest,
        // a cool dry steppe keeps more hardy tussock. Wet biomes (moist ≳ 0.32) are untouched.
        const dryness = Math.max(0, Math.min(1, (0.32 - moist) / 0.30));  // 0 lush .. 1 arid
        const heat = Math.max(0, Math.min(1, (temp - 0.45) / 0.25));      // 0 cool .. 1 hot
        const keepGrass = Math.max(0.05, Math.pow(1 - dryness, 1.3 + 0.9 * heat));

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
          // Thin the grass carpet on arid ground (see keepGrass above) — dropped attempts
          // leave bare dune/hardpan showing, so a desert reads as sparse scrub, not meadow.
          if (keepGrass < 0.999 && hash2(fx * 5.7 + 3.1, fy * 8.3 + 1.9) > keepGrass) continue;
          const tall = hash2(fx * 4.3 + 5.5, fy * 9.1 + 2.2);                   // hero-tuft field
          emit(fx, fy, e, 'grass', (tall > 0.74 ? 29 : 23) * (0.85 + 0.4 * sJit), 0.85, 0.12);
        }
      }
    }
  }
  };
  scan();
  if (wantLand > nLand || wantWeed > nWeed) {
    // Overflow: rescan with uniform thinning targeted just under the cap (0.995 leaves
    // headroom for hash variance, so the tail of the second pass isn't truncated either).
    keepLand = Math.min(1, (MAX_GRASS * 0.995) / Math.max(1, wantLand));
    keepWeed = Math.min(1, (MAX_WEED * 0.995) / Math.max(1, wantWeed));
    nLand = 0; nWeed = 0; wantLand = 0; wantWeed = 0;
    scan();
  }
  // Concatenate with SEAWEED FIRST so the renderer can draw instances [0, seaweedCount) as
  // the pre-water submerged sub-pass and [seaweedCount, count) as the over-water land pass.
  const count = nWeed + nLand;
  const data = new Float32Array(count * GRASS_INSTANCE_FLOATS);
  data.set(weed.subarray(0, nWeed * GRASS_INSTANCE_FLOATS), 0);
  data.set(land.subarray(0, nLand * GRASS_INSTANCE_FLOATS), nWeed * GRASS_INSTANCE_FLOATS);
  return { data, count, seaweedCount: nWeed };
}
