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
}

/**
 * Default island shape. `end <= 1.0` guarantees the edge midpoints (d = 1) and
 * the corners (d ≈ 1.41 euclidean) are fully sunk → a closed ocean frame; the
 * interior (d < start) is untouched, with a tapered coast between.
 */
export const DEFAULT_ISLAND: IslandSpec = { shape: 'euclidean', start: 0.62, end: 1.0 };

/** Hermite smoothstep, clamped to [0,1]. */
function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge1 <= edge0) return x < edge0 ? 0 : 1;
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
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
  // Normalise tile centre to [-1, 1] on each axis (a 1-wide axis stays centred).
  const nx = width  <= 1 ? 0 : (x / (width  - 1)) * 2 - 1;
  const ny = height <= 1 ? 0 : (y / (height - 1)) * 2 - 1;
  const d = spec.shape === 'square'
    ? Math.max(Math.abs(nx), Math.abs(ny))
    : Math.hypot(nx, ny);
  return smoothstep(spec.start, spec.end, d);
}

/**
 * Sink the edges of an elevation field toward ocean in place, multiplicatively
 * (`elevation *= 1 - falloff`). Row-major `[width*height]`. Returns the same array.
 */
export function applyIslandMask(
  elevation: Float32Array,
  width: number,
  height: number,
  spec: IslandSpec = DEFAULT_ISLAND,
): Float32Array {
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const f = islandFalloff(x, y, width, height, spec);
      if (f > 0) elevation[y * width + x] *= 1 - f;
    }
  }
  return elevation;
}
