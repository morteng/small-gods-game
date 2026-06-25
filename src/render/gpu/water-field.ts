// src/render/gpu/water-field.ts
//
// Water S2 — the pure CPU half: pack the per-cell fields the water shader
// (`wgsl/water-wgsl.ts`) samples as storage buffers, mirroring terrain-field.ts.
// All data comes from the (memoised, deterministic) hydrology model; the shader
// reads the SAME composed-terrain height buffer the terrain pass uses, so water
// depth = surfaceW − terrainHeight needs no extra upload. No GPU/DOM here.

import type { GameMap, ConnectomeWaterOverride } from '@/core/types';
import { terrainGrid, terrainGlobalsFor, curveRenderElev, heightField } from '@/render/gpu/terrain-field';
import { ELEVATION_SEA_LEVEL } from '@/world/heightfield';
import { worldStyleOf } from '@/core/world-style';
import { packTerrainGlobals, TERRAIN_GLOBALS_FLOATS, type TerrainGlobalsInput } from '@/render/gpu/instance-buffer';
import type { LightingState } from '@/render/lighting-state';
import { getHydrologyResult } from '@/world/hydrology-store';
import { buildRiverSurfaceFieldMemo } from '@/render/gpu/river-surface-field';
import { getRiverChannelGeometry, type RiverChannelGeometry } from '@/render/gpu/river-channel-geometry';
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
/** WGlobals = TGlobals (24) + uWater vec4 + uChannel vec4 + uWindow vec4 = 36
 *  floats / 144 bytes. `uChannel` carries the analytic river-channel
 *  acceleration-grid dims (bucketTiles, nbx, nby, segCount) the shader's
 *  `channelAt` reads; `uWindow` carries the viewport mesh-cull window (tile
 *  origin x,y + cell span w,h) so the vertex shader only generates quads over
 *  the visible tiles instead of the whole map. */
export const WATER_GLOBALS_FLOATS = TERRAIN_GLOBALS_FLOATS + 12;

/** Element-wise equality of two same-length Float32Arrays. */
function eqF32(a: Float32Array, b: Float32Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Equality of two OPTIONAL fields (the "applied" cache vs the live input): both
 *  absent ⇒ equal; one absent ⇒ changed; else element-wise. */
function eqOptF32(a: Float32Array | undefined, b: Float32Array | null): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return eqF32(a, b);
}

/** A fresh, zeroed set of the five per-cell water-surface arrays (one ping-pong slot). */
function allocSurfaceArrays(cells: number): WaterSurfaceArrays {
  return {
    surfaceW: new Float32Array(cells),
    waterType: new Uint32Array(cells),
    shallow: new Uint32Array(cells),
    deep: new Uint32Array(cells),
    clarity: new Float32Array(cells),
  };
}

/** Linear-RGB 0..1 → 0xAABBGGRR (LE-friendly upload; shader unpacks to 0..1). */
function rgbToAbgr(c: Rgb): number {
  const r = Math.round(Math.min(1, Math.max(0, c[0])) * 255);
  const g = Math.round(Math.min(1, Math.max(0, c[1])) * 255);
  const b = Math.round(Math.min(1, Math.max(0, c[2])) * 255);
  return ((0xff << 24) | (b << 16) | (g << 8) | r) >>> 0;
}

/** The GLOBAL water-level offset (drought < 0, flood > 0 metres) in NORMALISED render
 *  elevation — the single source both water passes read: the cell-grid lake plane
 *  (`uWater.w`) and the river ribbon (`riverLevelDeltaN`), so lakes and rivers shift
 *  together under one drought/flood. (Per-cell/per-body changes go through the ΔW
 *  composition; this is the world-wide datum shift.) */
export function waterLevelNorm(map: GameMap, waterLevelM: number): number {
  return waterLevelM / worldStyleOf(map.worldSeed).mountainRelief;
}

/** Pack the water uniform: the terrain globals, then `uWater`, then `uChannel`
 *  (the river-channel acceleration-grid dims — defaults to a no-river `[1,1,1,0]`),
 *  then `uWindow` (the viewport mesh-cull window — defaults to the whole map so the
 *  vertex shader draws every tile, byte-identical to the pre-cull grid). */
export function packWaterGlobals(
  g: TerrainGlobalsInput,
  water: [number, number, number, number],
  channel: [number, number, number, number] = [1, 1, 1, 0],
  window: [number, number, number, number] = [0, 0, g.grid[0], g.grid[1]],
): Float32Array {
  const b = new Float32Array(WATER_GLOBALS_FLOATS);
  b.set(packTerrainGlobals(g), 0);
  b[24] = water[0]; b[25] = water[1]; b[26] = water[2]; b[27] = water[3];
  b[28] = channel[0]; b[29] = channel[1]; b[30] = channel[2]; b[31] = channel[3];
  b[32] = window[0]; b[33] = window[1]; b[34] = window[2]; b[35] = window[3];
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
  /** Analytic river-channel geometry (segment buffer + CSR bucket index) the shader
   *  reads to draw rivers as a smooth signed-distance silhouette — the connectome
   *  projected directly, NOT a baked per-cell mask. Null on a world with no rivers
   *  (the shader's river path then no-ops via `segCount == 0`). */
  channel: RiverChannelGeometry | null;
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
  /** Per-CELL standing-water depth in METRES above the local terrain (≥0) — the
   *  "flood a plain" field (`WaterDynamics.floodOffsetM`). Unlike `lakeOffsetM` (which
   *  only raises EXISTING lake basins), this lays water on ARBITRARY dry land: each
   *  flooded cell's surface is set to bed + depth and its type flipped to still water,
   *  so the per-pixel clip carves the sheet to the terrain contour. Sparse — when every
   *  entry is 0 the cached static surface is reused (no re-upload). */
  floodOffsetM?: Float32Array;
  /** OPT-IN connectome-projected water (studio editing) — author-placed lakes the
   *  hydrology raster never knew, merged into the static classification + surface so
   *  they render like generated lakes. Absent → pure raster path (byte-identical). */
  connectomeWater?: ConnectomeWaterOverride;
  /** Pre-built (studio-memoised) river-channel geometry from the LIVE edited network,
   *  so a dragged node re-projects instantly while idle frames keep a stable reference
   *  (the GPU upload guard then skips). When absent the memoised per-(seed,dims) channel
   *  is used — the stable game path. */
  riverChannel?: RiverChannelGeometry;
  maxQuads?: number;
  /** Sub-tile mesh supersample (≥1; 1 = one quad/tile) — MUST match the terrain pass
   *  so the water plane and the terrain it clips against share one LOD grid (aligned
   *  waterlines). Drives only the draw count + `stepT` in the shader; the per-cell
   *  surface buffers are LOD-independent, so changing it never re-bakes the static.
   *  NOTE: the WATER shader never subdivides (one quad per coarsened tile), so the
   *  superSample only ever COARSENS the water draw count here — it never multiplies it. */
  superSample?: number;
  /** Viewport mesh-cull window in TILES: only generate water quads over the visible
   *  tile rect (inclusive bounds), not the whole map. The water plane sits on the
   *  sea-level z=0 plane (no height lift), so the screen-corner → tile projection that
   *  produces these bounds is exact — no lift margin needed. Absent ⇒ whole-map mesh
   *  (the byte-identical default; used by the static profiler / any caller without a
   *  camera rect). The window is snapped to the coarsen lattice internally. */
  window?: { minTx: number; minTy: number; maxTx: number; maxTy: number };
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
  // ── unified dynamic-water bake (the ΔW composition) ─────────────────────────────
  // ONE ping-pong set of all five surface arrays, written by `applyDynamicWater` from
  // the static base ⊕ (lake offset + flood). Lazily allocated on the first dynamic
  // water, reused forever after (no per-frame alloc → no GC spikes). Toggling the set
  // hands the GPU upload guard a CHANGED reference exactly when the bake changed — so a
  // held flood/lake costs nothing, and a moving one (rising, evaporating) re-uploads.
  dynSetA?: WaterSurfaceArrays;
  dynSetB?: WaterSurfaceArrays;
  dynToggle: boolean;
  /** The set the last bake wrote — handed out (stable ref) on frames that don't rebuild. */
  dynActive?: WaterSurfaceArrays;
  /** Inputs last baked — skip the rebuild + GPU re-upload on frames where neither the
   *  lake offsets nor the flood depths changed (a held flood, a settled world). */
  dynAppliedLake?: Float32Array;
  dynAppliedFlood?: Float32Array;
  /** Wall-clock seconds of the last bake — re-baked (and re-uploaded) at most ~12 Hz
   *  while moving, since a full per-cell surface re-upload every frame stalls software-WebGPU. */
  dynBuiltAt?: number;
  /** Curved render-terrain height (the bed a flood sits on), lazily built on first flood. */
  bedRender?: Float32Array;
  /** Default freshwater colours for a flooded land cell (a still sheet reads as a lake). */
  floodShallowC?: number;
  floodDeepC?: number;
  floodClarityC?: number;
  wetCount: number;
  /** null = world is bone dry (skip the pass). */
  dry: boolean;
}

const STATIC_CACHE = new WeakMap<GameMap, WaterStatic>();
// Separate, version-keyed cache for the studio's edited (placed-lake) statics — kept
// off the WeakMap so a connectome edit never poisons the game's pristine raster static.
const OVERRIDE_STATIC_CACHE = new Map<string, WaterStatic>();
const OVERRIDE_CACHE_CAP = 3;

function waterStatic(map: GameMap, override?: ConnectomeWaterOverride): WaterStatic {
  if (!override) {
    const cached = STATIC_CACHE.get(map);
    if (cached) return cached;
  } else {
    const cached = OVERRIDE_STATIC_CACHE.get(`${map.seed}:${map.width}x${map.height}:v${override.version}`);
    if (cached) return cached;
  }

  const hydro = getHydrologyResult(map);
  const cells = map.width * map.height;

  // EFFECTIVE water classification: the raster, plus any author-placed connectome lakes
  // (cells the override marks Lake that the raster left dry). Absent override ⇒ the same
  // array references the raster path always used, so the build is byte-identical.
  let effType: Uint8Array = hydro.waterType;
  let effMask: Uint8Array = hydro.waterMask;
  const placed: number[] = [];
  if (override) {
    effType = Uint8Array.from(hydro.waterType);
    effMask = Uint8Array.from(hydro.waterMask);
    for (let i = 0; i < cells; i++) {
      if (override.waterType[i] === WaterType.Lake
          && effType[i] !== WaterType.Lake && effType[i] !== WaterType.Ocean) {
        effType[i] = WaterType.Lake;
        effMask[i] = 1;
        placed.push(i);
      }
    }
  }

  let wet = 0;
  for (const m of effMask) wet += m;


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
    const b = biomeFor(effType[i] as WaterType);
    if (b) {
      shallow[i] = rgbToAbgr(b.shallowColor);
      deep[i] = rgbToAbgr(b.deepColor);
      clarity[i] = b.clarity;
    }
  }

  // NOTE: the LOD grid (subsample + vertex count) is camera/zoom-dependent, so it is
  // computed per-FRAME in buildWaterField — NOT baked here, or the per-map static cache
  // would freeze the mesh resolution. The per-cell surface buffers below are all
  // LOD-independent (one entry per tile), so the static survives any zoom-LOD change.
  const shoreDist = computeShoreDist(map.width, map.height, effMask);

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
  // Author-placed lakes have no raster surface — fill them to their spill lip (the
  // override carries it in render-elevation space). Then the shore/flood/body passes
  // below treat them exactly like a generated lake.
  for (const i of placed) surfaceW[i] = override!.lakeSurface[i];
  const waterType = Uint32Array.from(effType);
  // RIVERS join the per-cell water field (the unified water system). `hydro.surfaceW`
  // is raw pre-erosion elevation, so it can't lift the render mesh — use the
  // render-space, bank-referenced fill (`river-surface-field`) for river cells. The
  // per-pixel waterline clip then trims each reach to its REAL erosion-carved channel,
  // which hugs the terrain contours far better than the swept ribbon did.
  const riverSurf = buildRiverSurfaceFieldMemo(map);
  if (riverSurf) {
    for (let i = 0; i < cells; i++) {
      // `effType` (not the raster) so a placed lake sitting over a river keeps its lake
      // surface rather than being pulled back to the river fill line.
      if (effType[i] === WaterType.River) surfaceW[i] = riverSurf[i];
    }
  }
  fillShoreRing(map.width, map.height, effMask, {
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

  // Default freshwater colours for the flood layer — a still sheet on land reads as a
  // lake. Resolved once from the world climate (same source the lake cells use).
  const lakeBiome = biomeFor(WaterType.Lake);

  const stat: WaterStatic = {
    surfaceW,
    waterType,
    flow, shallow, deep, clarity, shoreDist,
    floodShallowC: lakeBiome ? rgbToAbgr(lakeBiome.shallowColor) : rgbToAbgr([0.2, 0.4, 0.55]),
    floodDeepC: lakeBiome ? rgbToAbgr(lakeBiome.deepColor) : rgbToAbgr([0.08, 0.2, 0.35]),
    floodClarityC: lakeBiome ? lakeBiome.clarity : 0.6,
    lakeBodies,
    lakeCells: Int32Array.from(lakeCellArr),
    dynToggle: false,
    wetCount: wet,
    dry: wet === 0,
  };
  if (!override) {
    STATIC_CACHE.set(map, stat);
  } else {
    const k = `${map.seed}:${map.width}x${map.height}:v${override.version}`;
    OVERRIDE_STATIC_CACHE.set(k, stat);
    if (OVERRIDE_STATIC_CACHE.size > OVERRIDE_CACHE_CAP) {
      const oldest = OVERRIDE_STATIC_CACHE.keys().next().value;
      if (oldest !== undefined) OVERRIDE_STATIC_CACHE.delete(oldest);
    }
  }
  return stat;
}

/** The per-cell water-surface arrays a dynamic-water bake reads (base) and writes (out). */
export interface WaterSurfaceArrays {
  /** Row-major water-surface height in NORMALISED render elevation. */
  surfaceW: Float32Array;
  waterType: Uint32Array;
  shallow: Uint32Array;
  deep: Uint32Array;
  clarity: Float32Array;
}

/** Everything the one dynamic-water rule needs beyond the base/out arrays. */
export interface DynamicWaterInputs {
  /** Per-lake-body level offset (metres), indexed by lake body id. null = none. */
  lakeOffsetM: Float32Array | null;
  /** Flat list of every render lake cell — the per-body offset touches only these. */
  lakeCells: Int32Array;
  /** Per-cell lake body id (−1 = not a lake cell), for the per-body offset lookup. */
  bodyId: Int32Array;
  /** Per-cell standing-water depth above terrain (metres). null = no flood. */
  floodOffsetM: Float32Array | null;
  /** Curved render-terrain height (the bed a flood sits on); required iff flooding. */
  bed: Float32Array | null;
  /** metres → normalised-elevation divisor (world relief). */
  relief: number;
  /** Freshwater colours/clarity a flooded land cell takes (a still sheet = a lake). */
  floodShallowC: number;
  floodDeepC: number;
  floodClarityC: number;
}

/**
 * The ONE dynamic-water composition rule (the ΔW unification). Seeds `out` from the
 * static `base`, then folds EVERY dynamic water source into a single per-cell water
 * surface — replacing the prior two sequential mutating blocks (lake-offset, then
 * flood) with one rule whose overlap behaviour is explicit:
 *
 *   1. per-body LAKE offset — raises/lowers an existing basin within its bank
 *      (additive on the static lake surface), applied only to that body's cells.
 *   2. per-cell FLOOD — standing water on arbitrary land, composited as
 *      `max(existing, bed + depth)`: a flood RAISES the surface to its level but
 *      never lowers a deeper river/lake already there (the consistent overlap rule —
 *      a shallow flood over a deep channel leaves the channel alone).
 *
 * Pure: writes only `out` (which may alias none of `base`'s arrays). Returns the
 * flooded cell indices so the caller can restore them to base when the flood recedes.
 */
export function applyDynamicWater(
  out: WaterSurfaceArrays, base: WaterSurfaceArrays, inp: DynamicWaterInputs,
): Int32Array {
  out.surfaceW.set(base.surfaceW);
  out.waterType.set(base.waterType);
  out.shallow.set(base.shallow);
  out.deep.set(base.deep);
  out.clarity.set(base.clarity);

  const { relief } = inp;
  const lo = inp.lakeOffsetM;
  if (lo) {
    const { bodyId, lakeCells } = inp;
    for (let k = 0; k < lakeCells.length; k++) {
      const i = lakeCells[k];
      const b = bodyId[i];
      if (b >= 0) out.surfaceW[i] = base.surfaceW[i] + lo[b] / relief;
    }
  }

  const fo = inp.floodOffsetM;
  const bed = inp.bed;
  const applied: number[] = [];
  if (fo && bed) {
    for (let i = 0; i < fo.length; i++) {
      const d = fo[i];
      if (d <= 0) continue;
      const surf = bed[i] + d / relief;
      if (surf <= out.surfaceW[i]) continue;     // a deeper river/lake already here
      out.surfaceW[i] = surf;
      out.waterType[i] = WaterType.Lake;
      out.shallow[i] = inp.floodShallowC;
      out.deep[i] = inp.floodDeepC;
      out.clarity[i] = inp.floodClarityC;
      applied.push(i);
    }
  }
  return Int32Array.from(applied);
}

/** A single-cell read of the unified water surface. */
export interface WaterProbe {
  /** True when standing water covers the tile (depth > 0 after the terrain clip). */
  wet: boolean;
  /** Standing depth above local terrain in METRES (0 when dry). */
  depthM: number;
  /** Water kind at the tile (`WaterType.Dry` when no water stands there). */
  type: WaterType;
}

/** Live dynamic offsets a {@link waterSurfaceAt} probe folds in (all optional —
 *  omit for the static-model height). Same arrays the field bake consumes. */
export interface WaterProbeDynamics {
  /** Per-lake-body level offset (metres), indexed by body id. */
  lakeOffsetM?: Float32Array | null;
  /** Per-cell standing-water depth above terrain (metres). */
  floodOffsetM?: Float32Array | null;
  /** Global inland water-level offset (metres; drought < 0, flood > 0). */
  waterLevelM?: number;
}

/**
 * Point-query the unified water surface — "is there water at this tile, and how
 * deep?" — for sim / gameplay code (the read-side companion to the GPU bake). It
 * mirrors {@link applyDynamicWater}'s rule EXACTLY for one cell, then applies the
 * shader's per-pixel clip (`surface − bed ≤ 0 ⇒ dry`), so the answer always agrees
 * with what the renderer draws:
 *
 *   1. start from the memoised static surface + type,
 *   2. raise an existing LAKE body by its per-body offset,
 *   3. shift LAKE+RIVER cells by the global level (the sea stays the datum),
 *   4. fold a per-cell FLOOD as `max(existing, bed + depth)`,
 *   5. depth = (surface − bed)·relief; ≤ 0 reads as dry (the terrain clip).
 *
 * Cheap: the static water + curved bed are both memoised, so a probe is O(1).
 */
export function waterSurfaceAt(
  map: GameMap, x: number, y: number, dyn?: WaterProbeDynamics,
): WaterProbe {
  const dry: WaterProbe = { wet: false, depthM: 0, type: WaterType.Dry };
  const xi = Math.round(x), yi = Math.round(y);
  if (xi < 0 || yi < 0 || xi >= map.width || yi >= map.height) return dry;

  const i = yi * map.width + xi;
  const stat = waterStatic(map);
  const relief = worldStyleOf(map.worldSeed).mountainRelief;
  const bedN = heightField(map)[i];               // curved render terrain (the bed)

  let surf = stat.surfaceW[i];
  let type = stat.waterType[i] as WaterType;

  // (2) per-body LAKE offset — raise an existing basin within its bank.
  const lo = dyn?.lakeOffsetM ?? null;
  if (lo && type === WaterType.Lake) {
    const b = stat.lakeBodies.bodyId[i];
    if (b >= 0) surf = stat.surfaceW[i] + lo[b] / relief;
  }
  // (3) GLOBAL level — lakes + rivers shift together; the ocean is the fixed datum.
  const glM = dyn?.waterLevelM ?? 0;
  if (glM !== 0 && (type === WaterType.Lake || type === WaterType.River)) {
    surf += glM / relief;
  }
  // (4) per-cell FLOOD — max(existing, bed + depth); never lowers a deeper channel.
  const fo = dyn?.floodOffsetM ?? null;
  if (fo && fo[i] > 0) {
    const fsurf = bedN + fo[i] / relief;
    if (fsurf > surf) { surf = fsurf; type = WaterType.Lake; }
  }

  // (5) the per-pixel terrain clip, in metres.
  const depthM = (surf - bedN) * relief;
  if (type === WaterType.Dry || depthM <= 0) return dry;
  return { wet: true, depthM, type };
}

/** River > Lake > Ocean > Dry — prefer the more specific body when several cover one cell. */
function bodyRank(t: WaterType): number {
  return t === WaterType.River ? 3 : t === WaterType.Lake ? 2 : t === WaterType.Ocean ? 1 : 0;
}

/**
 * Does the PAINTED water plane cover tile (tx,ty) — i.e. is this cell BLUE on screen?
 *
 * The rendered water reaches ~1 cell PAST the classified channel: the shader bilinearly
 * samples the per-cell surface field, so a dry-classified bank cell sitting under a
 * neighbour's fill line still draws water (and the waterline is the sub-cell contour
 * where that interpolated surface crosses the terrain). A per-cell classification lookup
 * therefore disagrees with the eye on exactly the fringe the cursor most often lands on.
 *
 * This mirrors the paint: the cell is wet if its bed sits below the water SURFACE of
 * itself or any 8-neighbour water cell. Returns the covering body's type (most specific
 * wins). Static (no dynamic offsets) — the studio overhead hover has no live weather.
 * O(1): the static water + curved bed are memoised. The seam the studio hover reads so
 * "looks wet" and "says wet" finally agree.
 */
export function paintedWaterAt(map: GameMap, tx: number, ty: number): { wet: boolean; type: WaterType } {
  const W = map.width, H = map.height;
  if (tx < 0 || ty < 0 || tx >= W || ty >= H) return { wet: false, type: WaterType.Dry };
  const stat = waterStatic(map);
  if (stat.dry) return { wet: false, type: WaterType.Dry };
  const bed = heightField(map)[ty * W + tx];
  let type = WaterType.Dry;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const nx = tx + dx, ny = ty + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const ni = ny * W + nx;
      const t = stat.waterType[ni] as WaterType;
      if (t === WaterType.Dry) continue;
      // The neighbour's fill surface covers this cell's bed ⇒ the plane is painted here.
      if (stat.surfaceW[ni] > bed && bodyRank(t) > bodyRank(type)) type = t;
    }
  }
  return { wet: type !== WaterType.Dry, type };
}

/**
 * Assemble the `WaterField` for a world + camera frame, or `null` when the world
 * is bone dry (so the caller skips the pass entirely). The per-cell arrays are
 * cached per map (see `waterStatic`) — only the camera/time `globals` uniform is
 * rebuilt each frame, and the cached array references let the GPU upload skip its
 * per-frame writeBuffer.
 */
export function buildWaterField(map: GameMap, opts: BuildWaterFieldOpts): WaterField | null {
  const stat = waterStatic(map, opts.connectomeWater);
  if (stat.dry) return null;

  // LOD grid — computed PER FRAME (camera/zoom-dependent), with the SAME superSample
  // the terrain pass uses so the water plane and the terrain it clips against draw on
  // one shared grid (aligned waterlines under the zoom-LOD). The per-cell surface
  // buffers are LOD-independent, so this never re-bakes the static.
  const grid = terrainGrid(map.width, map.height, opts.maxQuads, opts.superSample);

  // WATER DRAW WINDOW. The water shader lays exactly ONE quad per coarsened tile (it
  // never subdivides — that's terrain-only), so the draw count is SUP-FREE: a window of
  // `cellsX × cellsY` tiles is `⌊cellsX/sub⌋ × ⌊cellsY/sub⌋` quads regardless of super-
  // Sample. We also CULL the mesh to the visible tile rect (water sits on the flat sea-
  // level plane, so the screen→tile projection that produced these bounds is exact — no
  // lift margin). The origin is snapped DOWN to the coarsen lattice so the sampled cells
  // (`ox0 + qx·sub`) stay on the same {0,sub,2·sub…} lattice the un-windowed grid used,
  // keeping the surface byte-identical. Absent window ⇒ the whole map (the static
  // profiler / camera-less callers), which on a slow GPU is the dominant primitive-bound
  // pass: ~104k quads/frame nearly all off-screen at gameplay zoom.
  const sub = grid.subsample;
  const W = map.width, H = map.height;
  let winX0 = 0, winY0 = 0, winCellsX = W, winCellsY = H;
  if (opts.window) {
    const wx = Math.max(0, Math.min(W - 1, Math.floor(opts.window.minTx)));
    const wy = Math.max(0, Math.min(H - 1, Math.floor(opts.window.minTy)));
    const ex = Math.max(wx, Math.min(W - 1, Math.floor(opts.window.maxTx))) + 1; // exclusive
    const ey = Math.max(wy, Math.min(H - 1, Math.floor(opts.window.maxTy))) + 1;
    winX0 = Math.floor(wx / sub) * sub;
    winY0 = Math.floor(wy / sub) * sub;
    winCellsX = Math.max(sub, Math.min(W - winX0, Math.ceil(ex / sub) * sub - winX0));
    winCellsY = Math.max(sub, Math.min(H - winY0, Math.ceil(ey / sub) * sub - winY0));
  }
  const waterVertexCount = Math.max(1, Math.floor(winCellsX / sub))
    * Math.max(1, Math.floor(winCellsY / sub)) * 6;

  // Water rides the terrain heightfield → it shares the terrain projection
  // uniform exactly; the only water-specific bits are the trailing uWater vec4.
  const tg: TerrainGlobalsInput = terrainGlobalsFor(map, {
    viewport: opts.viewport, xform: opts.xform, lighting: opts.lighting,
    subsample: grid.subsample, superSample: opts.superSample,
  });

  // DYNAMIC WATER — the ΔW composition. Fold the per-body LAKE level offset and the
  // per-cell FLOOD into ONE per-cell surface via the single `applyDynamicWater` rule
  // (was two sequential mutating blocks). A held / settled world reuses the cached
  // static arrays (reference-stable → the GPU upload guard skips); a moving one (a
  // basin rising, a flood evaporating) toggles the ping-pong set so the changed
  // reference re-uploads. The GLOBAL `waterLevelM` stays in-shader (uWater.w, below)
  // since a uniform shift needs no surface re-upload.
  let surfaceW = stat.surfaceW;
  let waterType = stat.waterType;
  let shallow = stat.shallow, deep = stat.deep, clarity = stat.clarity;

  const lo = opts.lakeOffsetM ?? null;
  const fo = opts.floodOffsetM ?? null;
  const lakeActive = !!lo && lo.some((v) => v !== 0);
  const floodActive = !!fo && fo.some((v) => v > 0);

  if (lakeActive || floodActive) {
    const now = opts.timeSec ?? 0;
    const due = stat.dynBuiltAt === undefined || now - stat.dynBuiltAt >= 0.08;   // ≤12 Hz
    const changed = !eqOptF32(stat.dynAppliedLake, lakeActive ? lo : null)
                 || !eqOptF32(stat.dynAppliedFlood, floodActive ? fo : null);
    if (!stat.dynSetA) {
      stat.dynSetA = allocSurfaceArrays(stat.surfaceW.length);
      stat.dynSetB = allocSurfaceArrays(stat.surfaceW.length);
    }
    if (((changed && due)) || !stat.dynActive) {
      if (floodActive && !stat.bedRender) stat.bedRender = heightField(map);
      stat.dynToggle = !stat.dynToggle;
      const set = stat.dynToggle ? stat.dynSetA! : stat.dynSetB!;
      applyDynamicWater(set, {
        surfaceW: stat.surfaceW, waterType: stat.waterType,
        shallow: stat.shallow, deep: stat.deep, clarity: stat.clarity,
      }, {
        lakeOffsetM: lakeActive ? lo : null,
        lakeCells: stat.lakeCells,
        bodyId: stat.lakeBodies.bodyId,
        floodOffsetM: floodActive ? fo : null,
        bed: floodActive ? stat.bedRender! : null,
        relief: worldStyleOf(map.worldSeed).mountainRelief,
        floodShallowC: stat.floodShallowC!,
        floodDeepC: stat.floodDeepC!,
        floodClarityC: stat.floodClarityC!,
      });
      stat.dynAppliedLake = lakeActive ? lo!.slice() : undefined;
      stat.dynAppliedFlood = floodActive ? fo!.slice() : undefined;
      stat.dynBuiltAt = now;
      stat.dynActive = set;
    }
    const set = stat.dynActive!;
    surfaceW = set.surfaceW; waterType = set.waterType;
    shallow = set.shallow; deep = set.deep; clarity = set.clarity;
  } else if (stat.dynActive) {
    // Fully receded since last frame — drop back to the cached static arrays (the dyn
    // sets stay allocated for the next event) so the GPU re-uploads the base once.
    stat.dynActive = undefined;
    stat.dynAppliedLake = undefined;
    stat.dynAppliedFlood = undefined;
  }

  // ANALYTIC RIVER CHANNEL — the connectome projected as segment + bucket geometry the
  // shader reads to draw rivers with a smooth signed-distance silhouette (no per-cell
  // staircase). A studio-edited network re-projects per frame (cheap, a few KB) so a
  // dragged node reflects instantly; the game path uses the memoised geometry, whose
  // stable reference lets the GPU upload guard skip the re-upload.
  const channel = opts.riverChannel ?? getRiverChannelGeometry(map);

  return {
    surfaceW,
    waterType,
    flow: stat.flow,
    shallow,
    deep,
    clarity,
    shoreDist: stat.shoreDist,
    channel,
    wetCount: stat.wetCount,
    vertexCount: waterVertexCount,
    // uWater.w carries the GLOBAL water-level offset in NORMALISED elevation, so a
    // drought/flood shifts the lake plane + waterline in-shader. The river ribbon
    // reads the SAME value (`waterLevelNorm`) so lakes and rivers rise together.
    // uChannel carries the river-channel acceleration-grid dims (or a no-river default).
    globals: packWaterGlobals(tg, [
      opts.timeSec ?? 0, SHALLOW_BAND_M, FOAM_BAND_M,
      waterLevelNorm(map, opts.waterLevelM ?? 0),
    ], channel
      ? [channel.bucketTiles, channel.nbx, channel.nby, channel.segCount]
      : [1, 1, 1, 0],
    [winX0, winY0, winCellsX, winCellsY]),
  };
}
