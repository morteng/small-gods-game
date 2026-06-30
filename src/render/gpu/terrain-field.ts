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

import type { GameMap, DevModeState, ConnectomeWaterOverride } from '@/core/types';
import { WaterType } from '@/core/types';
import { TILE_COLORS, WATER_TYPES } from '@/core/constants';
import { buildRenderWaterType } from '@/render/gpu/render-water-mask';
import { effectiveTileType, RENDER_LAYERS, layerFlag } from '@/render/layer-visibility';
import { ELEVATION_SEA_LEVEL, getClimateFields } from '@/world/heightfield';
import { getComposedHeightfield } from '@/world/road-deformation';
import { getRoadFeatureGeometry } from '@/render/gpu/feature-geometry';
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
 * multiplier to read). At reliefM=48 a sea-to-peak swing (~0.65) lifts ~625 px.
 * Render-only (does NOT touch the metre heightfield hydrology/roads read); raised
 * 17→20 toward a more storybook showcase look so hills + massifs read on the
 * default world. This is the seed default for the future `terrainVerticalExaggeration`
 * style knob (see the world-style / "game factor" epic) — raise toward a storybook
 * look, lower toward a flatter simulator look.
 */
export const TERRAIN_Z_PX_PER_M = 20.0;

/**
 * Terrain display modes — a shader uniform enum (`uMode.x`) branched in the
 * terrain fragment (`terrain-wgsl.ts`). `textured` is the shipped game look; the
 * rest are professional/analytic styles for the studio (and the game's debug
 * overlays): `contour` is the "vector" topographic map (flat hypsometric fill +
 * iso-elevation lines), `hypsometric` an elevation ramp, `biome` flat region
 * colours, `slope`/`normal` geometry debug. The detail-patch pass shares the
 * terrain fragment, so the mode applies to the fine patches too. Keep `value`
 * in sync with the shader's `switch`.
 */
export const TERRAIN_MODES = [
  { id: 'textured', label: 'Textured', value: 0 },
  { id: 'contour', label: 'Contour (vector)', value: 1 },
  { id: 'hypsometric', label: 'Hypsometric', value: 2 },
  { id: 'biome', label: 'Biome', value: 3 },
  { id: 'slope', label: 'Slope', value: 4 },
  { id: 'normal', label: 'Normals', value: 5 },
  { id: 'wireframe', label: 'Wireframe (mesh)', value: 6 },
] as const;
export type TerrainModeId = (typeof TERRAIN_MODES)[number]['id'];

/** Resolve a {@link TerrainModeId} to its shader enum value (0 = textured). */
export function terrainModeValue(id: TerrainModeId | undefined): number {
  return TERRAIN_MODES.find((m) => m.id === id)?.value ?? 0;
}

/** Cap on generated quads — picks the subsample LOD so big maps stay cheap. Raised
 *  from 50k: a default 384×272 world (~104k tiles) was rendering at subsample=2
 *  (HALF tile resolution), so carved valleys + shorelines showed coarse triangle
 *  facets. At 700k the typical world renders at full tile resolution (sub=1) — a 4×
 *  denser mesh — while very large maps still coarsen. A GPU generates ~10⁶ quads
 *  trivially and the terrain buffers are memoised, so the only per-frame cost is the
 *  (larger) draw call. (True sub-tile super-sampling is a planned follow-up.) */
export const MAX_TERRAIN_QUADS = 700_000;

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

/** Damp-earth fallback for a submerged bed when no dry neighbour is found nearby. */
const WETBED_FALLBACK = '#5E4C3A';
// Irrigated farm fields read a touch lusher/greener than rain-fed ones (`farm_field`
// #AED581) so the G7 irrigation system is legible at a glance. Render-only; the
// `irrigated` flag is set at worldgen and immutable at runtime, so the colour memo holds.
const IRRIGATED_FIELD_COLOR = '#9CCC65';
/** How far the carved bed is darkened vs the inherited bank colour (wet sheen). */
const WETBED_DARKEN = 0.62;

/**
 * Base colour for a SUBMERGED bed cell (river channel or lake basin). The terrain
 * must NOT paint water-blue — the ribbon pass (rivers) and the water pass (lakes)
 * own the entire wet look, so the bed below shows damp GROUND, not a doubled-up
 * blue smear. This matters the instant the water level RECEDES (drought): the
 * water pass clips per-pixel at the contour and reveals exactly this bed colour,
 * so a drained lake shows mud, not a blue stain. The bed inherits the nearest dry
 * neighbour's biome colour (grassy valley → muddy-green, desert → sandy), darkened
 * toward wet earth. Pure; only the wet cells hit this. A big lake's deep interior
 * (no dry neighbour within the ring) falls back to damp earth.
 */
function wetBedColorAbgr(
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
        const hex = TILE_COLORS[effectiveTileType(t.type, devMode)] ?? WETBED_FALLBACK;
        return darkenAbgr(hexToAbgr(hex), WETBED_DARKEN);
      }
    }
  }
  return darkenAbgr(hexToAbgr(WETBED_FALLBACK), 1);
}

/** Scale an 0xAABBGGRR colour's RGB toward black by `f` (alpha kept). */
function darkenAbgr(abgr: number, f: number): number {
  const a = abgr & 0xff000000;
  const b = Math.round(((abgr >> 16) & 0xff) * f);
  const g = Math.round(((abgr >> 8) & 0xff) * f);
  const r = Math.round((abgr & 0xff) * f);
  return (a | (b << 16) | (g << 8) | r) >>> 0;
}

/**
 * Pack the per-cell biome base colour as 0xAABBGGRR (LE-friendly for upload).
 *
 * `waterType` (the memoised hydrology classification, row-major) is optional: when
 * supplied, RIVER and LAKE cells are painted as damp BEDS (never blue) so a
 * receding water level reveals ground, not a stain — the wet look is owned by the
 * ribbon/water passes. Without it, only `'river'` tiles fall back to a bed colour
 * (the lake basin can't be told from the ocean by `tile.type` alone). Ocean stays
 * blue — it's the fixed datum that never recedes.
 */
export function packColorField(map: GameMap, devMode?: DevModeState, waterType?: Uint8Array): Uint32Array {
  const { width, height, tiles } = map;
  const out = new Uint32Array(width * height);
  for (let ty = 0; ty < height; ty++) {
    const row = tiles[ty];
    for (let tx = 0; tx < width; tx++) {
      const idx = ty * width + tx;
      const tile = row?.[tx];
      const wt = waterType ? waterType[idx] : (tile?.type === 'river' ? WaterType.River : WaterType.Dry);
      if (wt === WaterType.River || wt === WaterType.Lake) {
        // River channel + lake basin: damp ground bed, never blue. Revealed when
        // the ribbon/water pass clips the surface back on drought.
        out[idx] = wetBedColorAbgr(tiles, tx, ty, width, height, devMode);
        continue;
      }
      // Paint the biome *under* a road/bridge (baseType is set only when a road
      // overwrote real ground). The road's albedo comes from the shader surface
      // channel, so an overgrown road fades back to this ground instead of a flat
      // road-brown — and roads compose with snow/mud/wet like any other terrain.
      const colorType = tile ? (tile.baseType ?? tile.type) : undefined;
      let hex = colorType ? (TILE_COLORS[effectiveTileType(colorType, devMode)] ?? '#444') : '#1a1a24';
      if (tile?.irrigated && tile.type === 'farm_field') hex = IRRIGATED_FIELD_COLOR;
      out[idx] = hexToAbgr(hex);
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
export function packColorFieldMemo(map: GameMap, devMode?: DevModeState, renderWaterType?: Uint8Array, waterVersion = 0): Uint32Array {
  const key = `${map.width}x${map.height}|` +
    RENDER_LAYERS.map((l) => (devMode?.[layerFlag(l)] === false ? '0' : '1')).join('') +
    `|w${renderWaterType ? waterVersion : 'base'}`;
  if (colorMemo && colorMemo.map === map && colorMemo.key === key) return colorMemo.colors;
  // The RENDER waterType (ocean + lakes from hydrology, rivers re-stamped along the
  // smooth connectome centrelines) lets us paint LAKE basins + bendy river beds as
  // damp ground — not the D8-staircased raster rivers. The studio passes an EDITED
  // render waterType (author-placed lakes) so their beds read damp too; absent, it's
  // derived from the map (the memo key stays valid on map identity).
  const colors = packColorField(map, devMode, renderWaterType ?? buildRenderWaterType(map));
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
  /** Viewport-cull mesh window `[oxTile, oyTile, spanW, spanH]` in TILES (lattice-snapped),
   *  for the shader's `uWindow`. Whole-map `[0,0,W,H]` when no window was supplied. */
  window: [number, number, number, number];
}

/** A visible-tile cull rect in TILE coords (inclusive bounds), as produced by
 *  `visibleTileBounds`. `buildTerrainField` snaps it to the LOD lattice and adds a
 *  down-screen lift margin (tall peaks rise up-screen, so tiles just below the rect
 *  can still be visible). */
export interface TerrainWindow { minTx: number; minTy: number; maxTx: number; maxTy: number; }

/**
 * Choose the subsample LOD + vertex count for a map, honouring the quad cap.
 * `superSample` (≥1, default 1) SUBDIVIDES each tile into that many quads per edge
 * — the studio's "mesh resolution" control. The cap is enforced on the final
 * (post-supersample) quad count, so the auto-LOD coarsens the base grid if a high
 * supersample would blow the budget. At `superSample === 1` this is byte-identical
 * to the original (game) behaviour.
 */
export function terrainGrid(
  width: number, height: number, maxQuads = MAX_TERRAIN_QUADS, superSample = 1,
  window?: [number, number, number, number],
): TerrainGrid {
  const sup = Math.max(1, Math.floor(superSample));
  let subsample = 1;
  for (let s = 1; s <= 16; s++) {
    const qx = Math.max(1, Math.floor(width / s)) * sup;
    const qy = Math.max(1, Math.floor(height / s)) * sup;
    if (qx * qy <= maxQuads) { subsample = s; break; }
    subsample = s;
  }
  // The LOD `subsample` is chosen map-wide (so terrain + water coarsen identically);
  // the window only limits WHICH quads are emitted. Snap the origin DOWN and the span
  // UP to the subsample lattice so the sampled cell coordinates are unchanged — at the
  // default whole-map window this is byte-identical to the un-culled grid.
  let ox0 = 0, oy0 = 0, spanW = width, spanH = height;
  if (window) {
    const sub = subsample;
    const wx = Math.max(0, Math.min(width - 1, Math.floor(window[0])));
    const wy = Math.max(0, Math.min(height - 1, Math.floor(window[1])));
    const ex = Math.max(wx, Math.min(width - 1, Math.floor(window[2]))) + 1;
    const ey = Math.max(wy, Math.min(height - 1, Math.floor(window[3]))) + 1;
    ox0 = Math.floor(wx / sub) * sub;
    oy0 = Math.floor(wy / sub) * sub;
    spanW = Math.max(sub, Math.min(width - ox0, Math.ceil(ex / sub) * sub - ox0));
    spanH = Math.max(sub, Math.min(height - oy0, Math.ceil(ey / sub) * sub - oy0));
  }
  const quadsX = Math.max(1, Math.floor(spanW / subsample)) * sup;
  const quadsY = Math.max(1, Math.floor(spanH / subsample)) * sup;
  return { subsample, quadsX, quadsY, vertexCount: quadsX * quadsY * 6, window: [ox0, oy0, spanW, spanH] };
}

/** Hard ceiling on zoom-driven subdivision (a quad never finer than this per tile). */
const ZOOM_SUPER_MAX = 4;
/** Target art-pixels per mesh quad edge — below this, subdivide; above, coarsen. A
 *  zoomed-in tile spanning many art-pixels gets more quads so its silhouette + the
 *  waterline clipped against it read smooth, not tile-faceted. */
const ZOOM_SUPER_TARGET_PX = 20;

/**
 * Zoom-aware mesh subdivision: choose `superSample` from how many low-res art-pixels
 * one tile edge spans on screen (`ISO_TILE_W · sx`, where `sx` is the world→low-res
 * scale from {@link computeView}). Zoomed in (big tiles) → more quads → smooth
 * terrain + waterlines; zoomed out (tiny tiles) → 1 quad/tile (no wasted work).
 *
 * Bounded so it NEVER trips `terrainGrid`'s auto-coarsen (which would halve the base
 * grid and net nothing): the cap is the largest `sup` keeping `W·sup × H·sup` within
 * `maxQuads` at subsample 1. Pure; called per frame (cheap).
 */
export function zoomSuperSample(
  width: number, height: number, sx: number, maxQuads = MAX_TERRAIN_QUADS,
): number {
  const tileArtPx = ISO_TILE_W * Math.abs(sx);
  const desired = Math.round(tileArtPx / ZOOM_SUPER_TARGET_PX);
  // Largest sup that keeps the full-res grid (sub=1) under the quad budget.
  const budgetMax = Math.max(1, Math.floor(Math.sqrt(maxQuads / Math.max(1, width * height))));
  return Math.max(1, Math.min(desired, budgetMax, ZOOM_SUPER_MAX));
}

/** Coarsen target — below this many art-pixels per tile, ONE quad/tile is wasted
 *  geometry. At fit-zoom a tile spans only ~2-3 art-px, so the default 384×272 world
 *  draws ~104k quads (≈624k verts) every frame for a mesh no one can resolve. Finer
 *  than {@link ZOOM_SUPER_TARGET_PX} so the coast silhouette stays clean; perf is
 *  already saturated at subsample 2 (the water pass falls ~27× on this hardware), so
 *  the max coarsen is deliberately modest. */
const ZOOM_COARSEN_TARGET_PX = 8;
/** Never coarser than one quad per this-many tiles per edge (protects the silhouette). */
const ZOOM_COARSEN_MAX = 4;

/**
 * Zoom-aware mesh COARSENING — the zoom-out half of the LOD (the subdivide half is
 * {@link zoomSuperSample}). Returns a `maxQuads` cap to hand BOTH `buildTerrainField`
 * and `buildWaterField` so they pick the SAME coarser subsample (aligned waterlines).
 * The water pass is purely primitive-bound on weak GPUs — coarsening the mesh when a
 * tile is sub-pixel-ish is a large win at no visible cost (the per-pixel waterline is a
 * bicubic clip against the FULL-RES height buffers, LOD-independent, so it stays crisp).
 *
 * Returns the full `maxQuads` (no coarsening) once tiles are ≥ the target — at which
 * point `zoomSuperSample` takes over and SUBDIVIDES — so the two never fight. Pure.
 */
export function zoomCoarsenMaxQuads(
  width: number, height: number, sx: number, maxQuads = MAX_TERRAIN_QUADS,
): number {
  const tileArtPx = ISO_TILE_W * Math.abs(sx);
  if (tileArtPx >= ZOOM_COARSEN_TARGET_PX) return maxQuads;   // not zoomed out: full res (+ superSample)
  const sub = Math.min(ZOOM_COARSEN_MAX, Math.max(1, Math.round(ZOOM_COARSEN_TARGET_PX / Math.max(tileArtPx, 1e-3))));
  if (sub <= 1) return maxQuads;
  // Cap that makes terrainGrid pick exactly `sub` (the smallest s with ⌊W/s⌋·⌊H/s⌋ ≤ cap).
  return Math.max(1, Math.floor(width / sub)) * Math.max(1, Math.floor(height / sub));
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
  /** The road FEATURE geometry as a self-describing u32 buffer (feature-geometry.ts):
   *  a 4-word header + CSR bucket index + centreline segments. The shader evaluates
   *  pavedness analytically by distance to the centreline (no per-cell field), then ramps
   *  it to a road albedo (earth→cobble); snow/ice/mud still compose on top via climate. */
  roadFeature: Uint32Array;
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
  /** Terrain display mode enum (0 = textured). See {@link TERRAIN_MODES}. */
  terrainMode?: number;
  /** Sub-tile mesh supersample (≥1; 1 = one quad/tile). See {@link terrainGrid}. */
  superSample?: number;
  /** Viewport-cull rect in TILE coords (inclusive) — the mesh emits only quads inside
   *  it (plus a down-screen lift margin for tall peaks). Absent ⇒ whole-map mesh. */
  window?: TerrainWindow;
  /** OPT-IN connectome-projected water (studio editing) — its render waterType paints
   *  author-placed lake beds damp too. Absent → derived from the map (raster path). */
  connectomeWater?: ConnectomeWaterOverride;
}

/** Relative luminance of an RGB triple in `[0,1]` — terrain sun strength scalar. */
export function luminance(c: readonly [number, number, number]): number {
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

/** Max normalised elevation in the map's height buffer, memoised per height-array
 *  identity (stable until the world changes). Drives the viewport cull's down-screen
 *  lift margin: a tall peak lifts its geometry up-screen, so a tile just BELOW the
 *  visible rect can still be on-screen and must not be culled. */
const _maxElevByHeights = new WeakMap<Float32Array, number>();
export function terrainMaxElevation(map: GameMap): number {
  const h = heightField(map);
  let m = _maxElevByHeights.get(h);
  if (m === undefined) {
    m = 0;
    for (let i = 0; i < h.length; i++) if (h[i] > m) m = h[i];
    _maxElevByHeights.set(h, m);
  }
  return m;
}

/** Down-screen tile margin the cull window needs so a tall peak just below the visible
 *  rect isn't culled. A lift of `hPx` raises geometry by `hPx/halfH` tiles of (tx+ty);
 *  extending both maxTx and maxTy by Δ raises the covered (tx+ty) by 2Δ, so
 *  Δ = ceil(maxLiftPx / (2·halfH)) + 1 (= ceil(maxLiftPx / ISO_TILE_H) + 1). Pure. */
export function terrainLiftMarginTiles(map: GameMap): number {
  const style = worldStyleOf(map.worldSeed);
  const maxLiftPx = Math.max(0,
    (terrainMaxElevation(map) - ELEVATION_SEA_LEVEL) * style.mountainRelief * style.terrainVerticalExaggeration);
  return Math.ceil(maxLiftPx / ISO_TILE_H) + 1;
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
    /** Display mode enum (0 = textured). Defaults to 0 when omitted. */
    terrainMode?: number;
    /** Sub-tile mesh supersample (≥1; 1 = one quad/tile). Defaults to 1. */
    superSample?: number;
    /** Lattice-snapped cull window `[oxTile, oyTile, spanW, spanH]` (from `terrainGrid`).
     *  Absent ⇒ whole-map (the packer defaults to `[0,0,W,H]`). */
    window?: [number, number, number, number];
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
    terrainMode: opts.terrainMode ?? 0,
    terrainSuper: Math.max(1, Math.floor(opts.superSample ?? 1)),
    window: opts.window,
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
  // Viewport cull (T5): a tall peak lifts geometry up-screen, so extend the visible rect
  // DOWN-screen (+tx,+ty) by the map's max lift in tiles; the up-screen / east-west sides
  // only need the iso half-tile + lattice-snap slack the caller already baked in.
  let cullRect: [number, number, number, number] | undefined;
  if (opts.window) {
    const lift = terrainLiftMarginTiles(map);
    cullRect = [opts.window.minTx, opts.window.minTy, opts.window.maxTx + lift, opts.window.maxTy + lift];
  }
  const grid = terrainGrid(map.width, map.height, opts.maxQuads, opts.superSample, cullRect);
  const globals = terrainGlobalsFor(map, {
    viewport: opts.viewport, xform: opts.xform, lighting: opts.lighting, subsample: grid.subsample,
    terrainMode: opts.terrainMode, superSample: opts.superSample, window: grid.window,
  });
  const climate = getClimateFields(map);
  const cw = opts.connectomeWater;
  return {
    heights: heightField(map),
    colors: packColorFieldMemo(map, opts.devMode, cw?.waterType, cw?.version),
    moisture: climate.moisture,
    temperature: climate.temperature,
    roadFeature: getRoadFeatureGeometry(map).packed,
    vertexCount: grid.vertexCount,
    globals,
  };
}
