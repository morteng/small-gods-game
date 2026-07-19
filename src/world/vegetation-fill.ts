/**
 * Ground-cover FILL sweep: sow a grass/wildflower tuft into every open-ground cell
 * that ended up with nothing on it, so meadows read as a continuous sward instead of
 * a sparse sprinkle over bare green.
 *
 * WHY a separate pass and not just a denser brush. The grassland brush
 * (`vegetation-placer`) rolls an independent per-cell Bernoulli trial, so even at a
 * high authored density its EXPECTED count is well under one plant per cell — the
 * majority of grass cells come out empty, which is the "why is the ground so bare"
 * read. Cranking the brush density can't fix that cleanly (it clusters harder and
 * spikes the busy cells before it fills the empty ones) and it fights the placement
 * that other systems tuned against. This pass is the mirror image of
 * {@link clearObstructedVegetation}: it runs LAST, reads what actually landed, and
 * only touches cells that are genuinely bare — so it raises the floor without
 * disturbing anything already placed.
 *
 * Deterministic (position-keyed hash, the worldgen convention — never Math.random /
 * ctx.rng) and occupancy-aware: it skips roads/rivers, drawn water, buildings, cells
 * that already hold any nature entity, and non–open-ground tile types.
 */
import type { GameMap, Entity } from '@/core/types';
import type { World } from '@/world/world';
import { defaultEntity } from '@/world/brush-helpers';
import { tryGetEntityKindDef } from '@/world/entity-kinds';
import { isBuilding } from '@/world/building-collision';
import { getRenderWaterMask } from '@/world/render-water';
import { isRoadOrRiver } from '@/world/vegetation-clear';
import { worldStyleOf } from '@/core/world-style';
import { smoothNoise } from '@/core/noise';
import { getHeightfield, ELEVATION_SEA_LEVEL } from '@/world/heightfield';
import { styledIslandSpec } from '@/terrain/island-mask';
import { styledShapeSpec } from '@/terrain/terrain-shape';
import { siteMetrics } from '@/terrain/terrain-generator';
import { COVER_SLOPE } from '@/world/brushes/vegetation-placer';

/** Open-ground tile types that read as bare when unplanted — the grass sward. Matches
 *  the grassland brush's `tileType`; forest/scrub/wetland carry their own undergrowth. */
const FILL_GROUND = new Set(['grass', 'meadow', 'glen']);

/** Entity categories that count as existing cover — a cell holding one is not bare. */
const NATURE_CATEGORIES = new Set(['vegetation', 'terrain-feature']);

/** Brush prefix for fill ids — distinct from 'grassland' so ids never collide at a cell. */
const FILL_BRUSH = 'grassfill';

/** Ground-cover ACCENTS for the fill: wildflowers, tall tussock for silhouette, the odd
 *  small shrub. Plain grass is NOT here — the continuous sward is the terrain shader's job
 *  (analytic grass), so the entity layer only sprinkles the discrete hero objects a shader
 *  can't do well (real silhouettes: flower heads, a lone bush). */
const FILL_POOL: [string, number][] = [
  ['oxeye-daisy', 0.32],
  ['common-poppy', 0.24],
  ['foxglove', 0.16],
  ['tussock-grass', 0.16],   // a few tall tussocks break the flat sward with silhouette
  ['common-hawthorn', 0.06], // the occasional free-standing shrub
  ['gorse', 0.06],
];

/** Base probability a bare open-ground cell receives an accent (before clump + style).
 *  Sparse by design — accents dot the shader sward, they do not carpet it. */
const FILL_BASE_PROB = 0.18;

/** Tile span of the low-frequency clump field, so tufts drift into patches, not an
 *  even wash — mean-preserving (≈1), so it reshapes the fill without changing its total. */
const FILL_CLUMP_SCALE = 4;

/**
 * Decorrelated [0,1) position hash — the same Math.imul mix `vegetation-placer` uses,
 * so the fill shares the worldgen determinism convention (identical placement per
 * (x,y,seed)) without depending on a runtime RNG.
 */
function hash01(x: number, y: number, key: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(key | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** In-cell fraction in [0,1): centre jittered across the whole cell (no grid reveal). */
function cellFrac(rng: number): number {
  return rng; // full-cell scatter — grass must not expose the tile lattice
}

/** Weighted pick from [item, weight] pairs; rng in [0,1). */
function pickWeighted(rng: number, items: [string, number][]): string {
  let total = 0;
  for (const [, w] of items) total += w;
  let acc = 0;
  const r = rng * total;
  for (const [item, w] of items) {
    acc += w;
    if (r < acc) return item;
  }
  return items[items.length - 1][0];
}

/**
 * Sow ground-cover tufts into bare open-ground cells. Returns the number placed.
 * Deterministic from (map, seed); idempotent per world (re-running finds the cells it
 * already filled occupied and skips them).
 */
export function fillBareGround(world: World, map: GameMap, seed: number): number {
  const tiles = map.tiles;
  const height = map.height;
  const width = map.width;
  const isWater = getRenderWaterMask(map);
  const style = worldStyleOf(map.worldSeed);
  // Denser worlds (simulator 1.2) fill fuller; sparser (storybook 0.85) fill lighter —
  // the fill tracks the same dial as every brush so one lever moves the whole look.
  const floraDensity = style.floraDensity;
  // STEEPNESS: the fill runs LAST, after the biome brushes' SlopeBands have left the
  // painted-rock faces deliberately bare — without its own gate it re-planted exactly
  // those cells (the brushes' "bare" IS this pass's trigger). Same COVER_SLOPE ramp,
  // same siteMetrics slope, thinning via the Bernoulli prob so the fade stays smooth.
  const heightField = map.flatHeight
    ? null
    : getHeightfield(map.seed, width, height, styledIslandSpec(map.worldSeed), map.worldSeed?.pois ?? null, styledShapeSpec(map.worldSeed));
  const slopeKeep = (x: number, y: number): number => {
    if (!heightField) return 1;
    const slopeM = siteMetrics(heightField, x, y, width, height, ELEVATION_SEA_LEVEL, style.mountainRelief).slopeM;
    const lo = COVER_SLOPE.maxSlopeM - (COVER_SLOPE.bandM ?? COVER_SLOPE.maxSlopeM * 0.4);
    if (slopeM <= lo) return 1;
    if (slopeM >= COVER_SLOPE.maxSlopeM) return 0;
    return (COVER_SLOPE.maxSlopeM - slopeM) / (COVER_SLOPE.maxSlopeM - lo);
  };

  let placed = 0;
  for (let y = 0; y < height; y++) {
    const row = tiles[y];
    if (!row) continue;
    for (let x = 0; x < width; x++) {
      const tile = row[x];
      if (!tile || !FILL_GROUND.has(tile.type)) continue;
      if (isRoadOrRiver(tile.type)) continue;              // (redundant with the set, but explicit)
      if (isWater(x, y)) continue;                         // drawn water, incl. unstamped lake beds

      // Bare? Skip the cell if it holds any building or existing nature entity.
      let occupied = false;
      for (const e of world.registry.getAtTile(x, y)) {
        if (isBuilding(e)) { occupied = true; break; }
        const def = tryGetEntityKindDef(e.kind);
        if (def && NATURE_CATEGORIES.has(def.category)) { occupied = true; break; }
      }
      if (occupied) continue;

      // Clumped Bernoulli roll: patches of tufts, gaps between — never a flat carpet.
      const clump = smoothNoise(x, y, seed + 71, FILL_CLUMP_SCALE) * 2;
      const prob = Math.min(1, FILL_BASE_PROB * floraDensity * clump) * slopeKeep(x, y);
      const s = (seed ^ 0x51ed) + 0;
      if (hash01(x, y, s) >= prob) continue;

      const kind = pickWeighted(hash01(x, y, s + 1), FILL_POOL);
      const fx = cellFrac(hash01(x, y, s + 2));
      const fy = cellFrac(hash01(x, y, s + 3));
      const scale = 0.6 + hash01(x, y, s + 4) * 0.4;       // small ground cover, 0.6–1.0
      world.addEntity(defaultEntity(FILL_BRUSH, kind, x + fx, y + fy, {
        offsetX: fx,
        offsetY: fy,
        scale,
      }));
      placed++;
    }
  }
  return placed;
}
