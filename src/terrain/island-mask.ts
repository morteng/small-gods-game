/**
 * Island mask (connectome-driven world layout epic, slice W1).
 *
 * Noise terrain runs land all the way to the map border with no guarantee of a
 * water frame. The island mask shapes the landmass: it sinks the map edges below
 * sea level so every world reads as an island ("all lands are islands"), with a
 * tapered coast between the untouched interior and the deep-ocean border.
 *
 * Pure + deterministic: the falloff depends only on `(x, y, width, height, spec)`,
 * so the SAME mask is reproduced everywhere the elevation field is rebuilt — both
 * the biome/tile generation path (`generateTerrainFields` in terrain-generator)
 * and the render heightfield path (`computeHeightfield` in world/heightfield).
 * That shared determinism is what keeps water biomes and rendered terrain height
 * in agreement; both import {@link DEFAULT_ISLAND} so they cannot drift.
 */

export interface IslandSpec {
  /**
   * Distance metric over the normalised [-1,1]² grid:
   * - `euclidean` → an elliptical island inscribed in the (possibly rectangular) map.
   * - `square`    → max-axis distance; fills the rectangle, sinking only a border band.
   */
  shape: 'euclidean' | 'square';
  /** Normalised distance where the mask begins to bite. Below this: no reduction. */
  start: number;
  /** Normalised distance at/after which elevation is fully sunk to ocean. */
  end: number;
  /**
   * Central elevation dome height [0,1] ADDED at the island centre, tapering
   * smoothly to 0 by the coast (`start`). This is what makes an island read as
   * an island: land rising from the shore toward interior highlands, instead of
   * a flat disc with the ocean simply cut around it. The base fbm noise rides on
   * top, so the dome biases relief without flattening it into a smooth cone.
   * `0` = no dome (the legacy edge-sink-only behaviour).
   */
  dome?: number;
}

/**
 * Default island shape. `end <= 1.0` guarantees the edge midpoints (d = 1) and
 * the corners (d ≈ 1.41 euclidean) are fully sunk → a closed ocean frame; the
 * interior (d < start) is untouched, with a tapered coast between. The `dome`
 * lifts the interior so the island swells from coast to central highlands.
 */
export const DEFAULT_ISLAND: IslandSpec = { shape: 'euclidean', start: 0.62, end: 1.0, dome: 0.26 };

/**
 * Normalise a {@link WorldSeed.island} value to a spec (or null when off):
 * `false`/`undefined` → null, `true` → {@link DEFAULT_ISLAND}, a spec → itself.
 */
export function resolveIslandSpec(island: boolean | IslandSpec | undefined): IslandSpec | null {
  if (!island) return null;
  return island === true ? DEFAULT_ISLAND : island;
}

/** Stable, compact signature of a spec (for cache keys). `null` → "c" (continent). */
export function islandSignature(spec: IslandSpec | null): string {
  return spec ? `i${spec.shape[0]}${spec.start}-${spec.end}-${spec.dome ?? 0}` : 'c';
}

/** Hermite smoothstep, clamped to [0,1]. */
function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge1 <= edge0) return x < edge0 ? 0 : 1;
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Normalised radial distance of a tile from the island centre (0 = centre,
 *  1 = edge midpoint, ~1.41 = euclidean corner). Shared by the dome + falloff. */
function islandDistance(x: number, y: number, width: number, height: number, spec: IslandSpec): number {
  // Normalise tile centre to [-1, 1] on each axis (a 1-wide axis stays centred).
  const nx = width  <= 1 ? 0 : (x / (width  - 1)) * 2 - 1;
  const ny = height <= 1 ? 0 : (y / (height - 1)) * 2 - 1;
  return spec.shape === 'square'
    ? Math.max(Math.abs(nx), Math.abs(ny))
    : Math.hypot(nx, ny);
}

/**
 * Mask strength at a tile: `0` = keep elevation unchanged (interior),
 * `1` = fully sink to ocean (border). Pure and deterministic.
 */
export function islandFalloff(
  x: number,
  y: number,
  width: number,
  height: number,
  spec: IslandSpec = DEFAULT_ISLAND,
): number {
  return smoothstep(spec.start, spec.end, islandDistance(x, y, width, height, spec));
}

/**
 * Central dome elevation ADDED at a tile: peaks at `spec.dome` in the centre,
 * smoothly tapering to 0 by the coast band (`start`). 0 when no dome configured.
 */
export function islandDome(x: number, y: number, width: number, height: number, spec: IslandSpec = DEFAULT_ISLAND): number {
  const dome = spec.dome ?? 0;
  if (dome <= 0 || spec.start <= 0) return 0;
  const d = islandDistance(x, y, width, height, spec);
  // 1 at the centre → 0 at/beyond the coast band; smoothed into a rounded swell.
  const t = Math.max(0, Math.min(1, 1 - d / spec.start));
  return dome * (t * t * (3 - 2 * t));
}

/**
 * Shape an elevation field into an island in place: swell the interior with a
 * central dome (land rising from coast to highlands), then sink the edges toward
 * ocean (`elevation *= 1 - falloff`). Row-major `[width*height]`; values stay in
 * `[0,1]`. Returns the same array.
 */
export function applyIslandMask(
  elevation: Float32Array,
  width: number,
  height: number,
  spec: IslandSpec = DEFAULT_ISLAND,
): Float32Array {
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      let e = elevation[i] + islandDome(x, y, width, height, spec);
      const f = islandFalloff(x, y, width, height, spec);
      if (f > 0) e *= 1 - f;
      elevation[i] = e > 1 ? 1 : e < 0 ? 0 : e;
    }
  }
  return elevation;
}
