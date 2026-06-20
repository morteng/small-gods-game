// src/render/gpu/terrain-field.ts
//
// T1 (buffer-driven GPU terrain) — the pure CPU half: pack the per-cell FIELDS
// the terrain shader (`wgsl/terrain-wgsl.ts`) samples as storage buffers, and
// size the GPU-generated grid. Supersedes the R2d CPU vertex mesh
// (`terrain-mesh.ts`): the GPU now generates + lifts the grid from these
// buffers, so the only per-frame CPU cost is re-uploading CHANGED fields.
//
// Fields are row-major `width*height`:
//  - height : Float32 normalised elevation [0,1] — this IS `heightAt = base ⊕
//    deformations` (the deformation channel writes it). The base seed field
//    (`getHeightfield`) is already row-major, so it doubles as the buffer.
//  - colour : Uint32 0xAABBGGRR biome base colour per cell (lighting is applied
//    in-shader from the surface normal — colour is unlit biome only).
//
// No GPU/DOM here; everything is unit-testable.

import type { GameMap, DevModeState } from '@/core/types';
import { TILE_COLORS, WATER_TYPES } from '@/core/constants';
import { effectiveTileType, RENDER_LAYERS, layerFlag } from '@/render/layer-visibility';
import { ELEVATION_SEA_LEVEL, getClimateFields } from '@/world/heightfield';
import { getComposedHeightfield } from '@/world/road-deformation';
import { ISO_TILE_W, ISO_TILE_H } from '@/render/iso/iso-constants';
import type { LightingState } from '@/render/lighting-state';
import type { TerrainGlobalsInput } from '@/render/gpu/instance-buffer';
import { worldStyleOf } from '@/core/world-style';

/**
 * Canonical tile-space sun direction (x=east, y=up, z=south) — TOWARD the light,
 * from the upper north-west, so slopes shade legibly. The shader normalises it.
 * Unlike the entity sprites' screen-space `lighting.sunDir`, terrain normals are
 * tile-space, so terrain needs its own direction; a real day/night sweep (T3)
 * will rotate this. Intensity (ambient + sun strength + bands) still tracks the
 * live lighting so dusk/dawn dim the ground with the sprites.
 */
export const TERRAIN_SUN_DIR: [number, number, number] = [-1, 1.6, -1];

/**
 * Vertical z-scale: screen px per metre of relief — the "game factor" / vertical
 * exaggeration that maps the world's real-metre heightfield to screen pixels.
 * DELIBERATELY far below the XY scale (PX_PER_METRE=32): terrain z is compressed
 * for readability like most iso games (real GIS exaggeration is 2–3×, but iso
 * already halves apparent height, and our modest TERRAIN_RELIEF_M wants a larger
 * multiplier to read). At reliefM=48 a sea-to-peak swing (~0.65) lifts ~530 px.
 * This is the seed default for the future `terrainVerticalExaggeration` style
 * knob (see the world-style / "game factor" epic) — raise toward a storybook
 * look, lower toward a flatter simulator look.
 */
export const TERRAIN_Z_PX_PER_M = 17.0;

/** Cap on generated quads — picks the subsample LOD so big maps stay cheap. */
export const MAX_TERRAIN_QUADS = 50000;

/** The row-major normalised-elevation field (the height storage buffer): the
 *  base seed heightfield with the deformation channel composed on top (road
 *  grade-cuts today; rivers/earthworks as those producers land). Identical to
 *  the bare base field — same instance — for worlds with no deformations.
 *  (The map edge is hidden in the SHADERS, not by distorting geometry: the terrain
 *  fragment culls deep seabed + fades to dark, and the water/backdrop render a
 *  uniform infinite ocean over it — see terrain-wgsl / ocean-backdrop-wgsl.) */
/**
 * Non-linear RENDER height curve. Reshapes elevation ABOVE sea level by a gamma
 * on the above-sea fraction (`a' = a^gamma`), so a `gamma > 1` keeps high peaks
 * tall while flattening gentle mounds — a dramatic massif over soft valleys —
 * without touching the raw elevation that hydrology, biomes and roads read.
 *
 * Identity at/below sea level (preserves the seabed cull, ocean depth and every
 * elevation threshold) and at `gamma === 1` (the neutral default). Monotonic, so
 * the waterline's zero-crossing is preserved when the SAME curve is applied to
 * the water surface (`buildWaterField`). Pure.
 */
export function curveRenderElev(e: number, seaLevel: number, gamma: number): number {
  if (gamma === 1 || e <= seaLevel) return e;
  const span = 1 - seaLevel;
  if (span <= 0) return e;
  const a = (e - seaLevel) / span;            // above-sea fraction 0..1
  return seaLevel + Math.pow(a, gamma) * span;
}

// Curved height buffers are memoised by (base array identity, gamma): the base
// from getComposedHeightfield is itself memoised (stable reference for a static
// world), so the same curved array is returned each frame and the GPU upload's
// reference guard keeps hitting. A gamma of 1 returns the base array untouched
// (byte-parity, zero alloc).
const curveMemo = new WeakMap<Float32Array, { gamma: number; out: Float32Array }>();

/** Apply {@link curveRenderElev} across a whole height buffer (memoised). */
export function curveHeightBuffer(base: Float32Array, seaLevel: number, gamma: number): Float32Array {
  if (gamma === 1) return base;
  const hit = curveMemo.get(base);
  if (hit && hit.gamma === gamma) return hit.out;
  const out = new Float32Array(base.length);
  for (let i = 0; i < base.length; i++) out[i] = curveRenderElev(base[i], seaLevel, gamma);
  curveMemo.set(base, { gamma, out });
  return out;
}

export function heightField(map: GameMap): Float32Array {
  const base = getComposedHeightfield(map);
  return curveHeightBuffer(base, ELEVATION_SEA_LEVEL, worldStyleOf(map.worldSeed).terrainHeightGamma);
}

/** Damp-earth fallback for a river bed when no dry neighbour is found nearby. */
const RIVERBED_FALLBACK = '#5E4C3A';
/** How far the carved bed is darkened vs the inherited bank colour (wet sheen). */
const RIVERBED_DARKEN = 0.62;

/**
 * Base colour for a RIVER bed cell. The terrain must NOT paint river-blue — the
 * ribbon pass (`ribbon-wgsl`) owns the entire river water look, so the carved
 * channel below it shows damp GROUND, not a doubled-up blue smear that bleeds out
 * past the ribbon's frayed edges. The bed inherits the nearest dry neighbour's
 * biome colour (so a grassy valley gets a muddy-green bed, a desert a sandy one),
 * darkened toward wet earth. Pure; only the (few hundred) river cells hit this.
 */
function riverbedColorAbgr(
  tiles: GameMap['tiles'], x: number, y: number, width: number, height: number, devMode?: DevModeState,
): number {
  for (let r = 1; r <= 5; r++) {
    for (let dy = -r; dy <= r; dy++) {
      const ny = y + dy;
      if (ny < 0 || ny >= height) continue;
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; // ring only
        const nx = x + dx;
        if (nx < 0 || nx >= width) continue;
        const t = tiles[ny]?.[nx];
        if (!t || WATER_TYPES.has(t.type)) continue;
        const hex = TILE_COLORS[effectiveTileType(t.type, devMode)] ?? RIVERBED_FALLBACK;
        return darkenAbgr(hexToAbgr(hex), RIVERBED_DARKEN);
      }
    }
  }
  return darkenAbgr(hexToAbgr(RIVERBED_FALLBACK), 1);
}

/** Scale an 0xAABBGGRR colour's RGB toward black by `f` (alpha kept). */
function darkenAbgr(abgr: number, f: number): number {
  const a = abgr & 0xff000000;
  const b = Math.round(((abgr >> 16) & 0xff) * f);
  const g = Math.round(((abgr >> 8) & 0xff) * f);
  const r = Math.round((abgr & 0xff) * f);
  return (a | (b << 16) | (g << 8) | r) >>> 0;
}

/** Pack the per-cell biome base colour as 0xAABBGGRR (LE-friendly for upload). */
export function packColorField(map: GameMap, devMode?: DevModeState): Uint32Array {
  const { width, height, tiles } = map;
  const out = new Uint32Array(width * height);
  for (let ty = 0; ty < height; ty++) {
    const row = tiles[ty];
    for (let tx = 0; tx < width; tx++) {
      const tile = row?.[tx];
      if (tile && tile.type === 'river') {
        // Rivers render via the ribbon pass; the bed shows damp ground, never blue.
        out[ty * width + tx] = riverbedColorAbgr(tiles, tx, ty, width, height, devMode);
        continue;
      }
      const hex = tile ? (TILE_COLORS[effectiveTileType(tile.type, devMode)] ?? '#444') : '#1a1a24';
      out[ty * width + tx] = hexToAbgr(hex);
    }
  }
  return out;
}

/**
 * Memoised {@link packColorField}: returns the SAME array reference across frames
 * while the map identity, size and the layer-visibility key are unchanged, so the
 * GPU upload (and the 12k-cell rebuild) is skipped on a static world. The layer
 * key folds in the only `devMode` fields that change the colour (tile-type
 * overrides), so a dev toggle still rebuilds. Invalidated when the map object
 * changes (new world) — the per-tile `type` is otherwise immutable at runtime.
 */
let colorMemo: { map: GameMap; key: string; colors: Uint32Array } | null = null;
export function packColorFieldMemo(map: GameMap, devMode?: DevModeState): Uint32Array {
  const key = `${map.width}x${map.height}|` +
    RENDER_LAYERS.map((l) => (devMode?.[layerFlag(l)] === false ? '0' : '1')).join('');
  if (colorMemo && colorMemo.map === map && colorMemo.key === key) return colorMemo.colors;
  const colors = packColorField(map, devMode);
  colorMemo = { map, key, colors };
  return colors;
}

/** #rrggbb → 0xFFBBGGRR (alpha opaque). Unpacked in-shader by `unpackColor`. */
export function hexToAbgr(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return 0xff444444;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 0xff, g = (n >> 8) & 0xff, b = n & 0xff;
  return ((0xff << 24) | (b << 16) | (g << 8) | r) >>> 0;
}

export interface TerrainGrid {
  /** Subsample stride (1 = full res); higher on big maps to honour the cap. */
  subsample: number;
  /** Quads along each axis (grid-gen draws subsample-strided quads). */
  quadsX: number;
  quadsY: number;
  /** Vertices to draw: quadsX*quadsY*6 (2 tris/quad). */
  vertexCount: number;
}

/** Choose the subsample LOD + vertex count for a map, honouring the quad cap. */
export function terrainGrid(width: number, height: number, maxQuads = MAX_TERRAIN_QUADS): TerrainGrid {
  let subsample = 1;
  for (let s = 1; s <= 16; s++) {
    const qx = Math.max(1, Math.floor(width / s));
    const qy = Math.max(1, Math.floor(height / s));
    if (qx * qy <= maxQuads) { subsample = s; break; }
    subsample = s;
  }
  const quadsX = Math.max(1, Math.floor(width / subsample));
  const quadsY = Math.max(1, Math.floor(height / subsample));
  return { subsample, quadsX, quadsY, vertexCount: quadsX * quadsY * 6 };
}

/** The buffer-driven terrain handed to `GpuScene.renderFrame`: the per-cell
 *  storage fields, the GPU-generated vertex count, and the packed-ready uniform. */
export interface TerrainField {
  /** Row-major normalised elevation `[0,1]`, `width*height` (the height buffer). */
  heights: Float32Array;
  /** Row-major biome base colour `0xAABBGGRR`, `width*height` (the colour buffer). */
  colors: Uint32Array;
  /** Row-major moisture `[0,1]`, `width*height` — drives mud/grass material weight. */
  moisture: Float32Array;
  /** Row-major temperature `[0,1]`, `width*height` — drives the snowline (cold→snow). */
  temperature: Float32Array;
  /** Vertices the grid-gen vertex shader draws (`quadsX*quadsY*6`). */
  vertexCount: number;
  /** Terrain uniform input (camera + iso + z + lighting); `packTerrainGlobals`-ready. */
  globals: TerrainGlobalsInput;
}

export interface BuildTerrainFieldOpts {
  /** Device-pixel render target size `[w,h]`. */
  viewport: [number, number];
  /** World→device camera transform (same one baked into entity instances). */
  xform: { sx: number; sy: number; ox: number; oy: number };
  /** Live sky lighting — ambient + bands + sun strength track day/night. */
  lighting: LightingState;
  devMode?: DevModeState;
  maxQuads?: number;
}

/** Relative luminance of an RGB triple in `[0,1]` — terrain sun strength scalar. */
export function luminance(c: readonly [number, number, number]): number {
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

/**
 * Build the terrain/water shader uniform inputs for a world + camera frame. The
 * terrain and water passes share the SAME iso/z/lighting projection (water rides
 * the terrain heightfield), so both call this — the one place the world-style z
 * knobs, sea level, iso half-tile, sun direction and lighting are assembled. The
 * caller supplies the LOD `subsample` (from `terrainGrid`).
 */
export function terrainGlobalsFor(
  map: GameMap,
  opts: {
    viewport: [number, number];
    xform: { sx: number; sy: number; ox: number; oy: number };
    lighting: LightingState;
    subsample: number;
  },
): TerrainGlobalsInput {
  // S1 style knobs: vertical exaggeration + relief metres. Default to
  // TERRAIN_Z_PX_PER_M / TERRAIN_RELIEF_M, so unstyled worlds are unchanged.
  const style = worldStyleOf(map.worldSeed);
  return {
    viewport: opts.viewport,
    xform: opts.xform,
    grid: [map.width, map.height],
    half: [ISO_TILE_W / 2, ISO_TILE_H / 2],
    zPxPerM: style.terrainVerticalExaggeration,
    seaLevel: ELEVATION_SEA_LEVEL,
    reliefM: style.mountainRelief,
    subsample: opts.subsample,
    sunDir: TERRAIN_SUN_DIR,
    bands: opts.lighting.bands,
    ambient: opts.lighting.ambient,
    sunStrength: luminance(opts.lighting.sunColor),
  };
}

/**
 * Camera-independent lift field for framing/picking — the (memoised) height
 * buffer plus only the five globals `tileLiftPx`/`liftAt` read (grid, half, and
 * the z knobs). No viewport/lighting needed, so callers that just want "how far
 * up-screen is this tile lifted" (camera focus) can build it from the map alone.
 */
export function terrainLiftFieldFor(map: GameMap): { heights: Float32Array; globals: Pick<TerrainGlobalsInput, 'grid' | 'half' | 'zPxPerM' | 'seaLevel' | 'reliefM'> } {
  const style = worldStyleOf(map.worldSeed);
  return {
    heights: heightField(map),
    globals: {
      grid: [map.width, map.height],
      half: [ISO_TILE_W / 2, ISO_TILE_H / 2],
      zPxPerM: style.terrainVerticalExaggeration,
      seaLevel: ELEVATION_SEA_LEVEL,
      reliefM: style.mountainRelief,
    },
  };
}

/**
 * Assemble the full `TerrainField` for a world + camera frame: the (memoised)
 * height buffer, the biome colour buffer, the LOD vertex count, and the packed
 * uniform inputs. Cheap per-frame — `getHeightfield` is cached, so the height
 * array is reused; only the colour field and globals are recomputed.
 */
export function buildTerrainField(map: GameMap, opts: BuildTerrainFieldOpts): TerrainField {
  const grid = terrainGrid(map.width, map.height, opts.maxQuads);
  const globals = terrainGlobalsFor(map, {
    viewport: opts.viewport, xform: opts.xform, lighting: opts.lighting, subsample: grid.subsample,
  });
  const climate = getClimateFields(map);
  return {
    heights: heightField(map),
    colors: packColorFieldMemo(map, opts.devMode),
    moisture: climate.moisture,
    temperature: climate.temperature,
    vertexCount: grid.vertexCount,
    globals,
  };
}
