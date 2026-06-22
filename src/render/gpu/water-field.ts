// src/render/gpu/water-field.ts
//
// Water S2 — the pure CPU half: pack the per-cell fields the water shader
// (`wgsl/water-wgsl.ts`) samples as storage buffers, mirroring terrain-field.ts.
// All data comes from the (memoised, deterministic) hydrology model; the shader
// reads the SAME composed-terrain height buffer the terrain pass uses, so water
// depth = surfaceW − terrainHeight needs no extra upload. No GPU/DOM here.

import type { GameMap } from '@/core/types';
import { terrainGrid, terrainGlobalsFor, curveRenderElev } from '@/render/gpu/terrain-field';
import { ELEVATION_SEA_LEVEL } from '@/world/heightfield';
import { worldStyleOf } from '@/core/world-style';
import { packTerrainGlobals, TERRAIN_GLOBALS_FLOATS, type TerrainGlobalsInput } from '@/render/gpu/instance-buffer';
import type { LightingState } from '@/render/lighting-state';
import { getHydrologyResult } from '@/world/hydrology-store';
import { WaterType } from '@/core/types';
import { classifyWaterCell, climateOf, type AquaticBiome, type Rgb } from '@/water/water-biome';

/** Depth (m) below which water blends toward opaque — past it, water is opaque. */
export const SHALLOW_BAND_M = 1.5;
/** Depth (m) under which the shoreline foam band shows. */
export const FOAM_BAND_M = 0.4;
/** Extra rings a LAKE surface is dilated past its bank so a FLOOD can climb the
 *  shore. The 1-ring `fillShoreRing` overhang only lets the waterline advance one
 *  cell; a flood needs candidate land cells further out to clip against. Lakes
 *  only — the sea (ocean) is the datum and never floods, so it keeps the 1-ring
 *  overhang and pays no extra overdraw. A flood beyond this reach is ring-capped. */
export const LAKE_FLOOD_RINGS = 6;
/** WGlobals = TGlobals (24) + uWater vec4 = 28 floats / 112 bytes. */
export const WATER_GLOBALS_FLOATS = TERRAIN_GLOBALS_FLOATS + 4;

/** Element-wise equality of two same-length Float32Arrays. */
function eqF32(a: Float32Array, b: Float32Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Linear-RGB 0..1 → 0xAABBGGRR (LE-friendly upload; shader unpacks to 0..1). */
function rgbToAbgr(c: Rgb): number {
  const r = Math.round(Math.min(1, Math.max(0, c[0])) * 255);
  const g = Math.round(Math.min(1, Math.max(0, c[1])) * 255);
  const b = Math.round(Math.min(1, Math.max(0, c[2])) * 255);
  return ((0xff << 24) | (b << 16) | (g << 8) | r) >>> 0;
}

/** Pack the water uniform: the terrain globals followed by `uWater`. */
export function packWaterGlobals(
  g: TerrainGlobalsInput,
  water: [number, number, number, number],
): Float32Array {
  const b = new Float32Array(WATER_GLOBALS_FLOATS);
  b.set(packTerrainGlobals(g), 0);
  b[24] = water[0]; b[25] = water[1]; b[26] = water[2]; b[27] = water[3];
  return b;
}

/** The buffer-driven water surface handed to `GpuScene.renderFrame`. */
export interface WaterField {
  /** Row-major water-surface height (normalised elev), `width*height`; −1 dry. */
  surfaceW: Float32Array;
  /** Row-major `WaterType` per cell as u32, `width*height`. */
  waterType: Uint32Array;
  /** Row-major unit flow vectors interleaved (x,y), `2*width*height`. */
  flow: Float32Array;
  /** Per-cell aquatic-biome shallow colour `0xAABBGGRR` (S4); 0 on dry cells. */
  shallow: Uint32Array;
  /** Per-cell aquatic-biome deep colour `0xAABBGGRR` (S4). */
  deep: Uint32Array;
  /** Per-cell water clarity 0..1 (S4) — blend depth + caustic reach. */
  clarity: Float32Array;
  /** Per-cell distance to the nearest shore (land), in TILES; 0 on/at land,
   *  growing offshore. Drives shoreward swell bands + the breaking-foam line. */
  shoreDist: Float32Array;
  /** Wet cells in the field — the pass is skipped when 0. */
  wetCount: number;
  /** Vertices the grid-gen vertex shader draws (same LOD grid as terrain). */
  vertexCount: number;
  /** Packed water uniform (`WATER_GLOBALS_FLOATS`), ready to upload. */
  globals: Float32Array;
}

/**
 * Per-water-cell distance to the nearest shore (land cell), in tiles, via a
 * multi-source BFS seeded from every land cell (8-neighbour, so contours stay
 * round-ish around an island). Land reads 0; a water cell touching land reads 1,
 * and so on offshore. The shader bilinearly samples this so swell crests run
 * parallel to the coast and roll shoreward — "waves washing ashore" keyed to the
 * actual island shape. Cheap (one O(cells) sweep) and cached per map.
 */
export function computeShoreDist(width: number, height: number, waterMask: Uint8Array): Float32Array {
  const cells = width * height;
  const dist = new Float32Array(cells).fill(0);
  // Frontier = land cells adjacent to water (the coastline). BFS outward INTO
  // water only; land stays 0 (the shader never reads land cells).
  const queue = new Int32Array(cells);
  let head = 0, tail = 0;
  const visited = new Uint8Array(cells);
  for (let i = 0; i < cells; i++) {
    if (waterMask[i]) continue;          // land: distance 0, a BFS source
    visited[i] = 1;
    queue[tail++] = i;
  }
  while (head < tail) {
    const c = queue[head++];
    const cx = c % width;
    const cy = (c / width) | 0;
    const d = dist[c] + 1;
    for (let dy = -1; dy <= 1; dy++) {
      const ny = cy + dy;
      if (ny < 0 || ny >= height) continue;
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = cx + dx;
        if (nx < 0 || nx >= width) continue;
        const ni = ny * width + nx;
        if (visited[ni] || !waterMask[ni]) continue;
        visited[ni] = 1;
        dist[ni] = d;
        queue[tail++] = ni;
      }
    }
  }
  return dist;
}

/**
 * One-ring shore dilation — the CPU half of the pixel-perfect waterline. Copies
 * each WET cell's water attributes (surface height, type, biome colours, clarity,
 * flow) into its DRY 8-neighbours, so the water pass draws a flat water plane that
 * slightly OVERHANGS the bank on every side. The fragment shader then clips that
 * plane per-pixel at the exact terrain contour (`surfaceW − bed ≤ 0` → discard),
 * yielding a sub-cell waterline instead of the cell-quantised diamond staircase.
 *
 * Why a ring is needed: each cell's quad spans `[cell, cell+1]`, so a wet cell's
 * own quad covers only its +x/+y transitions; the −x/−y transitions live in the
 * dry neighbour's quad, which would otherwise be discarded wholesale (leaving a
 * half-cell of missing water — the staircase). Filling that neighbour lets its
 * quad draw the water up to the contour from the other side.
 *
 * Mutates the passed arrays IN PLACE. Reads the original `waterMask` to know the
 * wet/dry split: it only ever READS wet cells as sources and WRITES dry cells as
 * targets (disjoint sets), so in-place writes never chain outward past one ring.
 */
export function fillShoreRing(
  width: number,
  height: number,
  waterMask: Uint8Array,
  f: {
    surfaceW: Float32Array;
    waterType: Uint32Array;
    shallow: Uint32Array;
    deep: Uint32Array;
    clarity: Float32Array;
    flow: Float32Array;
  },
): void {
  const cells = width * height;
  for (let i = 0; i < cells; i++) {
    if (waterMask[i]) continue; // only fill dry cells
    const cx = i % width;
    const cy = (i / width) | 0;
    // Pick the wet neighbour with the HIGHEST surface (a conservative waterline —
    // the plane sits at the taller adjacent body so it can only ever over-reach,
    // never under-reach, the bank the depth clip then trims back).
    let src = -1;
    let bestSurf = -Infinity;
    for (let dy = -1; dy <= 1; dy++) {
      const ny = cy + dy;
      if (ny < 0 || ny >= height) continue;
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = cx + dx;
        if (nx < 0 || nx >= width) continue;
        const ni = ny * width + nx;
        if (!waterMask[ni]) continue; // sources are wet cells only
        if (f.surfaceW[ni] > bestSurf) {
          bestSurf = f.surfaceW[ni];
          src = ni;
        }
      }
    }
    if (src < 0) continue; // dry cell not on the shore ring — leave it dry (−1)
    f.surfaceW[i] = f.surfaceW[src];
    f.waterType[i] = f.waterType[src];
    f.shallow[i] = f.shallow[src];
    f.deep[i] = f.deep[src];
    f.clarity[i] = f.clarity[src];
    f.flow[i * 2] = f.flow[src * 2];
    f.flow[i * 2 + 1] = f.flow[src * 2 + 1];
  }
}

/**
 * Flood headroom for LAKES — dilate the lake water plane `rings` cells further out
 * than the 1-ring waterline overhang, so a positive water-level offset (flood) has
 * land cells to climb. A multi-source BFS seeded from every cell currently carrying
 * a LAKE surface (the original basin + the lake cells `fillShoreRing` already
 * overhung), expanding only into still-DRY cells (`surfaceW === -1`), each taking
 * its BFS parent's lake surface/colours. The in-shader depth clip
 * (`surfaceW + offset − terrain ≤ 0 → discard`) trims this generous band back to
 * the real contour every frame, so at level 0 the extra cells are all discarded
 * (their land terrain sits above the lake plane) and cost only a few hundred
 * discarded fragments. Ocean/river are left at the 1-ring overhang.
 *
 * Mutates the passed arrays IN PLACE; must run AFTER {@link fillShoreRing}.
 */
export function floodDilateLakes(
  width: number,
  height: number,
  rings: number,
  f: {
    surfaceW: Float32Array;
    waterType: Uint32Array;
    shallow: Uint32Array;
    deep: Uint32Array;
    clarity: Float32Array;
    flow: Float32Array;
  },
): void {
  if (rings <= 0) return;
  const cells = width * height;
  const dist = new Int16Array(cells).fill(-1);
  const queue = new Int32Array(cells);
  let head = 0, tail = 0;
  for (let i = 0; i < cells; i++) {
    if (f.waterType[i] === WaterType.Lake) { dist[i] = 0; queue[tail++] = i; }
  }
  while (head < tail) {
    const c = queue[head++];
    const d = dist[c];
    if (d >= rings) continue;
    const cx = c % width;
    const cy = (c / width) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      const ny = cy + dy;
      if (ny < 0 || ny >= height) continue;
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = cx + dx;
        if (nx < 0 || nx >= width) continue;
        const ni = ny * width + nx;
        if (dist[ni] !== -1) continue;          // already queued/seeded
        if (f.surfaceW[ni] !== -1) continue;     // occupied (wet or ring-1 overhang) — leave it
        dist[ni] = d + 1;
        f.surfaceW[ni] = f.surfaceW[c];
        f.waterType[ni] = WaterType.Lake;
        f.shallow[ni] = f.shallow[c];
        f.deep[ni] = f.deep[c];
        f.clarity[ni] = f.clarity[c];
        f.flow[ni * 2] = 0;
        f.flow[ni * 2 + 1] = 0;
        queue[tail++] = ni;
      }
    }
  }
}

export interface BuildWaterFieldOpts {
  viewport: [number, number];
  xform: { sx: number; sy: number; ox: number; oy: number };
  lighting: LightingState;
  /** Seconds, for ripple animation (pure render — never the sim clock). */
  timeSec?: number;
  /** Inland water-level offset in METRES (drought < 0, flood > 0) — shifts ALL LAKE
   *  surfaces uniformly (the sea is the fixed datum). Default 0. */
  waterLevelM?: number;
  /** LOCALIZED per-lake-body water-level offset in METRES, indexed by lake body
   *  (see {@link getLakeBodies}). The dynamic-weather layer (rain → runoff fills a
   *  basin) writes this so DIFFERENT lakes rise/recede independently; it's baked
   *  into the per-cell surface (so the GPU shader needs no extra binding). Sparse —
   *  when every entry is 0 the cached static surface is reused (no re-upload). */
  lakeOffsetM?: Float32Array;
  maxQuads?: number;
}

/** Connected lake bodies over the RENDER lake mask (Lake cells INCLUDING the
 *  shore/flood dilation), so a localized level offset can be applied per body and
 *  still cover the dilated overhang the waterline clips against. */
export interface LakeBodies {
  /** Per cell: lake-body index, or −1 where the cell is not a (render) lake. */
  bodyId: Int32Array;
  /** Surface area (cell count) of each body — converts a runoff VOLUME to a level. */
  areaCells: number[];
}

/** Flood-fill the render lake mask into connected bodies (4-neighbour). */
function computeLakeBodies(width: number, height: number, waterType: Uint32Array): LakeBodies {
  const cells = width * height;
  const bodyId = new Int32Array(cells).fill(-1);
  const areaCells: number[] = [];
  const queue = new Int32Array(cells);
  for (let s = 0; s < cells; s++) {
    if (waterType[s] !== WaterType.Lake || bodyId[s] !== -1) continue;
    const b = areaCells.length;
    let head = 0, tail = 0, area = 0;
    queue[tail++] = s; bodyId[s] = b;
    while (head < tail) {
      const c = queue[head++]; area++;
      const cx = c % width, cy = (c / width) | 0;
      const tryN = (nx: number, ny: number): void => {
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) return;
        const ni = ny * width + nx;
        if (bodyId[ni] === -1 && waterType[ni] === WaterType.Lake) { bodyId[ni] = b; queue[tail++] = ni; }
      };
      tryN(cx - 1, cy); tryN(cx + 1, cy); tryN(cx, cy - 1); tryN(cx, cy + 1);
    }
    areaCells.push(area);
  }
  return { bodyId, areaCells };
}

/** The (memoised) connected lake bodies of a world — the body index space the
 *  localized water-level offset (`lakeOffsetM`) is indexed in. */
export function getLakeBodies(map: GameMap): LakeBodies {
  return waterStatic(map).lakeBodies;
}

/** The per-cell water buffers — static for a given map (they come from the
 *  deterministic, memoised hydrology model). Cached so the live loop neither
 *  re-allocates nor re-loops over the whole map every frame, AND so the GPU
 *  upload's reference guard (`gpu-scene.uploadWaterFields`) actually hits and
 *  skips the per-frame writeBuffer. Only the `globals` uniform (camera/time)
 *  changes frame-to-frame. */
interface WaterStatic {
  surfaceW: Float32Array;
  waterType: Uint32Array;
  flow: Float32Array;
  shallow: Uint32Array;
  deep: Uint32Array;
  clarity: Float32Array;
  shoreDist: Float32Array;
  lakeBodies: LakeBodies;
  /** Flat list of every (render) lake cell — so a localized offset touches only the
   *  ~hundreds of lake cells, never the whole 100k-cell grid, each frame. */
  lakeCells: Int32Array;
  /** Ping-pong scratch surfaces for the localized offset (allocated lazily on first
   *  flood, reused forever after — no per-frame allocation → no GC spikes). Both are
   *  seeded from the base surface, and only lake cells are ever overwritten, so their
   *  non-lake cells stay equal to the base. Toggling gives the GPU upload guard a
   *  changed reference exactly when (and only when) the offset is live. */
  dynA?: Float32Array;
  dynB?: Float32Array;
  dynToggle: boolean;
  /** Per-body offsets last baked into the dyn surface — skips the rebuild + the
   *  GPU re-upload on frames where no basin level changed (a held flood, a settled
   *  world), so the localized layer only costs a writeBuffer while it's MOVING. */
  dynApplied?: Float32Array;
  /** Wall-clock seconds of the last dyn rebuild — the level offset is re-baked (and
   *  re-uploaded) at most ~12 Hz while it moves, since a lake level is slow and a
   *  full per-cell surface re-upload every frame stalls software-WebGPU. */
  dynBuiltAt?: number;
  wetCount: number;
  vertexCount: number;
  subsample: number;
  /** null = world is bone dry (skip the pass). */
  dry: boolean;
}

const STATIC_CACHE = new WeakMap<GameMap, WaterStatic>();

function waterStatic(map: GameMap, maxQuads?: number): WaterStatic {
  const cached = STATIC_CACHE.get(map);
  if (cached) return cached;

  const hydro = getHydrologyResult(map);
  let wet = 0;
  for (const m of hydro.waterMask) wet += m;

  const cells = map.width * map.height;
  const flow = new Float32Array(cells * 2);
  const shallow = new Uint32Array(cells);
  const deep = new Uint32Array(cells);
  const clarity = new Float32Array(cells);

  // Aquatic biome is constant per (climate × body kind), so resolve the body
  // kinds once and reuse — climate is world-level for this slice.
  const climate = climateOf(map.worldSeed?.biome);
  const biomeByType = new Map<WaterType, AquaticBiome | null>();
  const biomeFor = (wt: WaterType): AquaticBiome | null => {
    if (!biomeByType.has(wt)) biomeByType.set(wt, classifyWaterCell(wt, climate));
    return biomeByType.get(wt)!;
  };

  for (let i = 0; i < cells; i++) {
    flow[i * 2] = hydro.flowDirX[i];
    flow[i * 2 + 1] = hydro.flowDirY[i];
    const b = biomeFor(hydro.waterType[i] as WaterType);
    if (b) {
      shallow[i] = rgbToAbgr(b.shallowColor);
      deep[i] = rgbToAbgr(b.deepColor);
      clarity[i] = b.clarity;
    }
  }

  const grid = terrainGrid(map.width, map.height, maxQuads);
  const shoreDist = computeShoreDist(map.width, map.height, hydro.waterMask);

  // Clone the (shared, memoised) hydrology surface before dilating — fillShoreRing
  // mutates it to overhang the bank for the pixel-perfect waterline, and the
  // hydrology result must stay pristine for other consumers. `waterType` is already
  // a copy (Uint32Array.from); flow/shallow/deep/clarity are freshly allocated above.
  // Apply the SAME render height curve the terrain buffer uses (terrain-field
  // `heightField`) so the water plane rides the curved bed and the waterline's
  // zero-crossing stays put. Ocean (surfaceW == seaLevel) and dry (−1) are below/at
  // sea level ⇒ curve is identity there; only lake surfaces (above sea) shift.
  const gamma = worldStyleOf(map.worldSeed).terrainHeightGamma;
  const surfaceW = new Float32Array(cells);
  for (let i = 0; i < cells; i++) surfaceW[i] = curveRenderElev(hydro.surfaceW[i], ELEVATION_SEA_LEVEL, gamma);
  const waterType = Uint32Array.from(hydro.waterType);
  fillShoreRing(map.width, map.height, hydro.waterMask, {
    surfaceW, waterType, shallow, deep, clarity, flow,
  });
  // Give lakes flood headroom past the 1-ring waterline overhang (the sea is the
  // datum and never floods, so it's left at one ring).
  floodDilateLakes(map.width, map.height, LAKE_FLOOD_RINGS, {
    surfaceW, waterType, shallow, deep, clarity, flow,
  });

  // Connected lake bodies over the DILATED render lake mask — the index space the
  // localized water-level offset is keyed in — plus the flat lake-cell list.
  const lakeBodies = computeLakeBodies(map.width, map.height, waterType);
  const lakeCellArr: number[] = [];
  for (let i = 0; i < lakeBodies.bodyId.length; i++) if (lakeBodies.bodyId[i] >= 0) lakeCellArr.push(i);

  const stat: WaterStatic = {
    surfaceW,
    waterType,
    flow, shallow, deep, clarity, shoreDist,
    lakeBodies,
    lakeCells: Int32Array.from(lakeCellArr),
    dynToggle: false,
    wetCount: wet,
    vertexCount: grid.vertexCount,
    subsample: grid.subsample,
    dry: wet === 0,
  };
  STATIC_CACHE.set(map, stat);
  return stat;
}

/**
 * Assemble the `WaterField` for a world + camera frame, or `null` when the world
 * is bone dry (so the caller skips the pass entirely). The per-cell arrays are
 * cached per map (see `waterStatic`) — only the camera/time `globals` uniform is
 * rebuilt each frame, and the cached array references let the GPU upload skip its
 * per-frame writeBuffer.
 */
export function buildWaterField(map: GameMap, opts: BuildWaterFieldOpts): WaterField | null {
  const stat = waterStatic(map, opts.maxQuads);
  if (stat.dry) return null;

  // Water rides the terrain heightfield → it shares the terrain projection
  // uniform exactly; the only water-specific bits are the trailing uWater vec4.
  const tg: TerrainGlobalsInput = terrainGlobalsFor(map, {
    viewport: opts.viewport, xform: opts.xform, lighting: opts.lighting, subsample: stat.subsample,
  });

  // LOCALIZED lake level: bake a per-body metre offset into a fresh per-cell
  // surface so each basin rises/recedes independently (the global `waterLevelM`
  // above shifts ALL lakes; this is the dynamic-weather, per-basin layer). When
  // every body is at 0 the cached static surface is reused — reference-stable, so
  // the GPU upload's identity guard skips the per-frame writeBuffer.
  let surfaceW = stat.surfaceW;
  const lo = opts.lakeOffsetM;
  if (lo && lo.some((v) => v !== 0)) {
    // Only rebuild + re-upload the surface when a basin level actually CHANGED since
    // last frame — a held flood / settled world returns the SAME dyn buffer
    // reference, so the GPU upload guard skips and the localized layer costs nothing
    // once it stops moving. (A new array reference is produced only on change.)
    const now = opts.timeSec ?? 0;
    const due = stat.dynBuiltAt === undefined || now - stat.dynBuiltAt >= 0.08;   // ≤12 Hz
    const changed = !stat.dynApplied || !eqF32(stat.dynApplied, lo);
    if ((changed && due) || !stat.dynA) {
      const relief = worldStyleOf(map.worldSeed).mountainRelief;
      const { bodyId } = stat.lakeBodies;
      if (!stat.dynA) { stat.dynA = stat.surfaceW.slice(); stat.dynB = stat.surfaceW.slice(); }
      stat.dynToggle = !stat.dynToggle;
      const buf = stat.dynToggle ? stat.dynA : stat.dynB!;
      const cells = stat.lakeCells;
      for (let k = 0; k < cells.length; k++) {
        const i = cells[k];
        const b = bodyId[i];
        buf[i] = stat.surfaceW[i] + (b >= 0 ? lo[b] / relief : 0);
      }
      stat.dynApplied = lo.slice();
      stat.dynBuiltAt = now;
      surfaceW = buf;
    } else {
      // No rebuild this frame (held, or throttled) — reuse the last dyn surface so
      // the reference is stable and the GPU upload guard skips.
      surfaceW = stat.dynA ? (stat.dynToggle ? stat.dynA : stat.dynB!) : stat.surfaceW;
    }
  }

  return {
    surfaceW,
    waterType: stat.waterType,
    flow: stat.flow,
    shallow: stat.shallow,
    deep: stat.deep,
    clarity: stat.clarity,
    shoreDist: stat.shoreDist,
    wetCount: stat.wetCount,
    vertexCount: stat.vertexCount,
    // uWater.w carries the LAKE water-level offset in NORMALISED elevation (metres /
    // relief), so a drought/flood shifts the lake plane + waterline in-shader.
    globals: packWaterGlobals(tg, [
      opts.timeSec ?? 0, SHALLOW_BAND_M, FOAM_BAND_M,
      (opts.waterLevelM ?? 0) / worldStyleOf(map.worldSeed).mountainRelief,
    ]),
  };
}
