import { noise, smoothNoise } from '@/core/noise';
import { defaultEntity } from '@/world/brush-helpers';
import { getHeightfield, ELEVATION_SEA_LEVEL } from '@/world/heightfield';
import { styledIslandSpec } from '@/terrain/island-mask';
import { styledShapeSpec } from '@/terrain/terrain-shape';
import { worldStyleOf } from '@/core/world-style';
import type { Entity, Region, BrushContext } from '@/core/types';

/** A species' altitude ceiling (metres above sea) with a smooth thinning band —
 *  the TREELINE lever. Acceptance is 1 below `maxHeightM - bandM`, fades linearly
 *  to 0 at `maxHeightM`, and is 0 above: a species peters out toward its limit
 *  instead of stopping at a hard contour. `bandM` defaults to 15% of `maxHeightM`. */
export interface AltitudeBand {
  maxHeightM: number;
  bandM?: number;
}

export interface VegetationParams {
  /** Brush name for entity ID generation */
  brush: string;
  /** Tile type(s) this brush applies to (e.g., 'forest', or ['grass','meadow']) */
  tileType: string | string[];
  /** Primary tree/vegetation kinds with weights [kind, weight] */
  kinds: [string, number][];
  /** Base density (0-1): probability a tile gets a vegetation entity */
  density: number;
  /** Scale variation range [min, max] (e.g., [0.8, 1.2]) */
  scaleRange: [number, number];
  /** Rotation variation in degrees [-max, +max] (e.g., 15 for ±15°) */
  rotationRange: number;
  /**
   * Scatter window within a cell, per axis (0–0.5). 0.5 = scatter across the
   * whole cell (kills the tile grid); smaller values pull entities toward the
   * cell centre. Values above 0.5 are clamped so an entity never floors out of
   * its own tile.
   */
  offsetRange: [number, number];
  /**
   * Tile span of the low-frequency clump field that carves groves and
   * clearings out of the flat base density (default 5). Larger = broader
   * clumps. Set 0 to disable clumping (uniform scatter).
   */
  clumpScale?: number;
  /**
   * Maximum entities placed per cell (default 1). With >1, each cell rolls that
   * many independent sub-slots, so a cell can hold 0..N entities scattered
   * across it instead of the rigid at-most-one-per-tile lattice. Per-slot
   * probability is `density·clump / maxPerTile`, so the expected count per cell
   * stays `density·clump` — only its spatial distribution loosens.
   */
  maxPerTile?: number;
  /** Secondary undergrowth kinds (placed at lower density) */
  undergrowth?: [string, number, number][]; // [kind, weight, density]
  /**
   * Fraction of each undergrowth density that also applies in cells with NO
   * canopy (default 0 = the historic canopy-gated behaviour). Without it every
   * fern/flower/bramble hid under a tree and ground cover never appeared in
   * clearings or open ground.
   */
  openUndergrowth?: number;
  /**
   * Per-kind TREELINE bands (metres above sea): a primary kind listed here thins
   * out as the cell's altitude climbs toward its ceiling (see {@link AltitudeBand}).
   * Trees carry a ceiling so broadleaf stays low and conifers fade toward the
   * treeline; tussock/rocks/alpine shrubs are omitted (they grow at any altitude).
   * When present, the per-cell height is read once from the world heightfield —
   * seed-deterministic, so placement stays pure.
   */
  altitude?: Record<string, AltitudeBand>;
}

/** Smooth treeline acceptance in [0,1] for a cell height against a species band. */
function altitudeAccept(heightM: number, band: AltitudeBand): number {
  const bandM = band.bandM ?? band.maxHeightM * 0.15;
  const lo = band.maxHeightM - Math.max(0.01, bandM);
  if (heightM <= lo) return 1;
  if (heightM >= band.maxHeightM) return 0;
  return (band.maxHeightM - heightM) / (band.maxHeightM - lo);
}

/**
 * In-cell position as a fraction in [0, 1): the cell centre (0.5) jittered by a
 * noise sample, with the scatter window `range` clamped to 0.5 so the result
 * never leaves the cell. Stored verbatim as `offsetX/offsetY` so the topdown
 * renderer's `floor(e.x) + offsetX` reconstruction equals `e.x` exactly.
 */
function cellFrac(rng: number, range: number): number {
  const r = Math.min(0.5, Math.max(0, range));
  return 0.5 + (rng - 0.5) * 2 * r;
}

/**
 * Decorrelated [0, 1) hash for the per-slot placement rolls. The shared
 * `noise()` is a single LCG step, so values for nearby seeds (the gate seed `s`
 * vs the offset seed `s + 3`) come out strongly correlated — which biased every
 * tree's offset to the same side and reinforced the grid. This Math.imul mix
 * decorrelates the rolls so offsets actually scatter across the cell.
 */
function hash01(x: number, y: number, key: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(key | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * Place vegetation using shared noise-based parameters.
 * All parameters are deterministic from (x, y, seed).
 */
export function placeVegetation(
  region: Region,
  seed: number,
  ctx: BrushContext,
  params: VegetationParams,
): Entity[] {
  const out: Entity[] = [];
  const yEnd = region.y + region.h;
  const xEnd = region.x + region.w;

  const maxPerTile = Math.max(1, params.maxPerTile ?? 1);
  const tileTypes = new Set(Array.isArray(params.tileType) ? params.tileType : [params.tileType]);

  // World-style flora dial: `floraDensity` (world-style.ts) scales the brush's
  // authored base density AND its open-ground undergrowth share (capped so the
  // fraction stays a probability). Absent style (direct calls / legacy ctx) = 1,
  // i.e. today's behaviour. Purely a threshold change — the hash rolls are
  // untouched, so determinism per (x, y, seed) is preserved.
  const floraDensity = ctx.style?.floraDensity ?? 1;
  const density = params.density * floraDensity;
  const openUndergrowth = Math.min(1, (params.openUndergrowth ?? 0) * floraDensity);

  // TREELINE: fetch the seed-deterministic base heightfield ONCE (memoised) so a
  // per-species altitude ceiling can thin canopy toward the treeline. Skipped when
  // no band is declared (zero cost) or on the flat studio ground (no real relief).
  const m = ctx.tiles;
  const useAltitude = !!params.altitude && !m.flatHeight;
  const heightField = useAltitude
    ? getHeightfield(m.seed, m.width, m.height, styledIslandSpec(m.worldSeed), m.worldSeed?.pois ?? null, styledShapeSpec(m.worldSeed))
    : null;
  const reliefM = useAltitude ? worldStyleOf(m.worldSeed).mountainRelief : 0;
  const heightMAt = (x: number, y: number): number =>
    heightField ? (heightField[y * m.width + x] - ELEVATION_SEA_LEVEL) * reliefM : 0;

  for (let y = region.y; y < yEnd; y++) {
    for (let x = region.x; x < xEnd; x++) {
      const tile = ctx.tiles.tiles[y]?.[x];
      if (!tile || !tileTypes.has(tile.type)) continue;

      // Smooth low-frequency clump field so trees gather into groves and leave
      // clearings instead of an even lattice. Mean-preserving (≈1 on average),
      // so total density is unchanged — only its spatial distribution clusters.
      const clumpScale = params.clumpScale ?? 5;
      const clump = clumpScale > 0 ? smoothNoise(x, y, seed + 30, clumpScale) * 2 : 1;
      const perSlot = (density * clump) / maxPerTile;

      // Each cell rolls maxPerTile independent sub-slots, each scattered across
      // the whole cell — so placement is decorrelated from the tile lattice
      // (no more one-near-each-corner grid) and a cell may hold 0..N entities.
      let placedPrimary = false;
      for (let i = 0; i < maxPerTile; i++) {
        const s = seed + i * 101;
        if (hash01(x, y, s) >= perSlot) continue;

        const kind = pickWeighted(hash01(x, y, s + 1), params.kinds);
        // Treeline: a species with an altitude band thins as the cell climbs toward
        // its ceiling — a second decorrelated roll fades the slot out smoothly.
        const band = params.altitude?.[kind];
        if (band) {
          const accept = altitudeAccept(heightMAt(x, y), band);
          if (accept < 1 && hash01(x, y, s + 8) >= accept) continue;
        }
        placedPrimary = true;

        const fx = cellFrac(hash01(x, y, s + 3), params.offsetRange[0]);
        const fy = cellFrac(hash01(x, y, s + 4), params.offsetRange[1]);
        const scale = params.scaleRange[0] + hash01(x, y, s + 5) * (params.scaleRange[1] - params.scaleRange[0]);
        const rotation = (hash01(x, y, s + 6) - 0.5) * 2 * params.rotationRange;

        out.push(defaultEntity(params.brush, kind, x + fx, y + fy, {
          offsetX: fx,
          offsetY: fy,
          scale,
          rotation,
        }));
      }

      // Undergrowth: at most one per cell. Historically canopy-gated; the
      // `openUndergrowth` fraction lets a share grow in clearings/open cells so
      // flowers/ferns exist somewhere the player can actually see them.
      const ugScale = placedPrimary ? 1 : openUndergrowth;
      if (ugScale > 0 && params.undergrowth) {
        for (const [ugKind, ugWeight, ugDensity] of params.undergrowth) {
          const ugRng = hash01(x, y, seed + 10 + ugKind.length);
          if (ugRng < ugDensity * ugScale) {
            const ugKindPicked = pickWeighted(ugRng, [[ugKind, ugWeight]]);
            const ugFx = cellFrac(hash01(x, y, seed + 20), 0.35);
            const ugFy = cellFrac(hash01(x, y, seed + 21), 0.35);
            out.push(defaultEntity(params.brush, ugKindPicked, x + ugFx, y + ugFy, {
              offsetX: ugFx,
              offsetY: ugFy,
              scale: 0.6 + hash01(x, y, seed + 22) * 0.4, // Smaller scale: 0.6-1.0
            }));
          }
        }
      }
    }
  }
  return out;
}

/**
 * Pick a weighted random item from a list of [item, weight] pairs.
 * rng should be in [0, 1).
 */
function pickWeighted(rng: number, items: [string, number][]): string {
  let cumulative = 0;
  for (const [item, weight] of items) {
    cumulative += weight;
    if (rng < cumulative) return item;
  }
  return items[items.length - 1][0]; // Fallback to last item
}

/**
 * Helper to create density noise check with perlin noise for smoother biome transitions.
 * Returns true if vegetation should be placed at (x, y).
 */
export function shouldPlaceAt(
  x: number,
  y: number,
  seed: number,
  baseDensity: number,
  noiseScale: number = 0.1,
): boolean {
  // Combine perlin noise with seeded random for natural-looking edges
  const n = noise(x * noiseScale, y * noiseScale, seed);
  return n < baseDensity;
}
