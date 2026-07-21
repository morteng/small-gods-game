import { noise, smoothNoise } from '@/core/noise';
import { defaultEntity } from '@/world/brush-helpers';
import { getHeightfield, ELEVATION_SEA_LEVEL } from '@/world/heightfield';
import { siteMetrics } from '@/terrain/terrain-generator';
import { styledIslandSpec } from '@/terrain/island-mask';
import { styledShapeSpec } from '@/terrain/terrain-shape';
import { worldStyleOf } from '@/core/world-style';
import { getClimateFields } from '@/world/heightfield';
import { dust01 } from '@/render/dust-mask';
import { getFloraSpecies, floraGenParams } from '@/flora/flora-registry';
import type { Entity, Region, BrushContext, GameMap, FloraTintField } from '@/core/types';

/** A species' altitude ceiling (metres above sea) with a smooth thinning band —
 *  the TREELINE lever. Acceptance is 1 below `maxHeightM - bandM`, fades linearly
 *  to 0 at `maxHeightM`, and is 0 above: a species peters out toward its limit
 *  instead of stopping at a hard contour. `bandM` defaults to 15% of `maxHeightM`. */
export interface AltitudeBand {
  maxHeightM: number;
  bandM?: number;
}

/**
 * A species' STEEPNESS ceiling, in metres of rise per tile — the same `slopeM` measure
 * `classifyBiome` reads (`siteMetrics`, terrain-generator.ts: central differences on the
 * elevation field × relief), so "steep" means one thing in this codebase.
 *
 * The lever exists because nothing stops a scatter from gluing a boulder to a cliff FACE.
 * Physically a loose rock cannot rest above the angle of repose (~35°, and one tile is 2 m,
 * so 35° ≈ 1.4 m of rise per tile) — it sheds downhill into the talus at the foot. Rooted
 * plants hold a steeper slope than a loose stone does, so they carry a looser band. Like
 * {@link AltitudeBand} the ramp is SMOOTH: acceptance fades to 0 across the top of the band
 * rather than stopping at a contour, so no visible line appears where rocks run out.
 */
export interface SlopeBand {
  /** Steepest ground the kind ever sits on (m rise / tile). Acceptance is 0 at/above. */
  maxSlopeM: number;
  /** Width of the thinning band below the ceiling (default 40 % of it). */
  bandM?: number;
}

/** Shared steepness bands (m rise / tile; one tile = 2 m). CALIBRATED TO THE PAINT,
 *  not to physics: the terrain shader's slope is computed in SCREEN space with the
 *  vertical exaggeration baked in (zPxPerM 20 px/m against an 8 px half-tile), so the
 *  rock ramp (wRock in from render-slope ~0.42, visible ~0.5, saturated 0.78) maps back
 *  to PHYSICAL gradients of only ~0.55 / ~0.7 / ~1.8 m per tile. A band in true
 *  angle-of-repose metres (1.4 ≈ 35°) therefore left grass mats standing on ground the
 *  shader had already painted as bare cliff — the exact bug these exist to kill.
 *  COVER (grass tufts / heather mat) dies as the paint arrives: fading from ~0.55,
 *  gone by 0.85. TREE lets go a little later (a trunk on a part-painted brow is fine,
 *  on a face it floats); CONIFER clings longest of the rooted kinds. STONE closes
 *  almost as early as COVER: a rock SPRITE pasted over the painted face reads as
 *  floating on the cliff (user report), so loose stone keeps to the foot slopes and
 *  brows below the paint and the face itself stays pure shader rock. Against the
 *  measured upland distribution (hills.ts: p50 ≈ 0.4, p90 ≈ 1.2, p99 ≈ 2, faces to
 *  ~11.6) COVER thins across the p75–p90 tail and rolling ground below ~0.55 keeps
 *  its full mat. Every band is a smooth thinning ramp, never a contour line. */
export const STONE_SLOPE: SlopeBand = { maxSlopeM: 1.1, bandM: 0.4 };
export const TREE_SLOPE: SlopeBand = { maxSlopeM: 1.3, bandM: 0.5 };
export const CONIFER_SLOPE: SlopeBand = { maxSlopeM: 1.5, bandM: 0.55 };
export const COVER_SLOPE: SlopeBand = { maxSlopeM: 0.85, bandM: 0.3 };

/** Blanket every kind of a weighted pool with one band — how a brush covers its
 *  canopy/undergrowth pools; spread per-kind overrides after it (later keys win). */
export function slopeBandAll(
  kinds: ReadonlyArray<readonly [string, ...unknown[]]>, band: SlopeBand,
): Record<string, SlopeBand> {
  return Object.fromEntries(kinds.map(([k]) => [k, band]));
}

/** Dust cull strength per moisture ecology: wet species never root in painted dust,
 *  mesic ones nearly never (a little tolerance keeps dust edges from looking sterile),
 *  dry species are AT HOME on it and are left unlisted. */
const DUST_STRENGTH_BY_MOISTURE: Record<string, number> = { wet: 1, mesic: 0.9 };

/**
 * Derive the per-kind bare-ground (`dust`) cull strengths for a kind list FROM THE
 * FLORA DB's moisture ecology — the unified rule, not a per-brush hand list. A dry
 * species (gorse, juniper, cactus) is omitted: painted dust/scree is its habitat.
 * Non-flora kinds (field-stone, boulders, debris) have no species entry and are
 * omitted the same way — loose stone belongs on scree.
 */
export function dustBandAll(
  kinds: ReadonlyArray<readonly [string, ...unknown[]]>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k] of kinds) {
    const sp = getFloraSpecies(k);
    const strength = sp?.ecology.moisture ? DUST_STRENGTH_BY_MOISTURE[sp.ecology.moisture] : undefined;
    if (strength !== undefined) out[k] = strength;
  }
  return out;
}

/**
 * T4 (flora-into-ground): habit/leaf-derived fallback tint (0xRRGGBB) for a
 * species with no authored `petalTint` — so the ground wash differentiates a
 * dark conifer, a paler deciduous broadleaf, an olive shrub and a pale-green
 * sward instead of flattening every non-flower to one green. Calibrated by eye
 * against the botanical facts already on each DB entry (`leafType`/
 * `leafPhenology`), not a new fact source. Rocks (habit `'rock'`) return
 * `undefined` — loose stone contributes no living-cover coloration.
 */
function habitFallbackTint(species: NonNullable<ReturnType<typeof getFloraSpecies>>): number | undefined {
  const b = species.botanical;
  switch (b.habit) {
    case 'tree':
      if (b.leafType === 'needle' || b.leafType === 'scale') return 0x2e4a30; // dark conifer needle
      return b.leafPhenology === 'evergreen' ? 0x3b5d34 : 0x7fa85a;           // deep evergreen vs paler deciduous leaf
    case 'shrub': return 0x6b7f45;   // olive shrub foliage
    case 'grass': return 0x9ebe6b;   // pale yellow-green sward
    case 'fern': return 0x3f6b3a;    // deep fern green
    case 'herb': return 0x8fae5e;    // pale foliage green (pre-/non-bloom herb)
    case 'rock': return undefined;
    default: return undefined;
  }
}

/**
 * T4: the ground-tint colour a placed species contributes, 0xRRGGBB → RGB
 * triple. An authored `petalTint` (flowers/herbs — see `flora-species.ts`)
 * wins outright since it IS the real bloom colour; otherwise
 * {@link habitFallbackTint}. Unknown ids (non-flora entity kinds — debris,
 * rubble) and rocks return `null`: they contribute no flora coloration.
 */
export function speciesTintRgb(kind: string): [number, number, number] | null {
  const species = getFloraSpecies(kind);
  if (!species) return null;
  const petal = floraGenParams(kind)?.petalTint;
  const hex = petal && petal > 0 ? petal : habitFallbackTint(species);
  if (hex === undefined) return null;
  return [(hex >> 16) & 0xff, (hex >> 8) & 0xff, hex & 0xff];
}

/**
 * T4: fold one placed plant's colour into `map.floraTint` (see
 * `GameMap.floraTint` doc), weighted by `weight` (the entity's `scale` — a
 * bigger tuft/tree covers more of the cell) so the eventual blend in
 * `packColorField` tracks actual placed cover density, not just presence.
 * Lazily allocates the field on first real contribution — a kind with no
 * derivable tint (rocks, unknown ids) never creates it, so a floraless/
 * rock-only cell leaves `map.floraTint` untouched (possibly still `undefined`
 * for the whole map, matching the "no-op on a floraless world" contract).
 * Out-of-bounds cells are ignored defensively (placement always emits
 * in-bounds; the check is guard-rail, not load-bearing).
 */
export function accumulateFloraTint(map: GameMap, x: number, y: number, kind: string, weight: number): void {
  if (!(weight > 0)) return;
  const rgb = speciesTintRgb(kind);
  if (!rgb) return;
  const tx = Math.floor(x), ty = Math.floor(y);
  if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return;
  const idx = ty * map.width + tx;
  let field: FloraTintField | undefined = map.floraTint;
  if (!field) {
    const n = map.width * map.height;
    field = {
      width: map.width, height: map.height,
      sumR: new Float32Array(n), sumG: new Float32Array(n), sumB: new Float32Array(n),
      weight: new Float32Array(n),
    };
    map.floraTint = field;
  }
  field.sumR[idx] += rgb[0] * weight;
  field.sumG[idx] += rgb[1] * weight;
  field.sumB[idx] += rgb[2] * weight;
  field.weight[idx] += weight;
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
  /**
   * Per-kind STEEPNESS bands (see {@link SlopeBand}): a kind listed here thins out as
   * the ground steepens and never sits on a cliff face. Rocks want this (a boulder does
   * not rest above the angle of repose); so does ground cover (tussock on a vertical
   * face reads as glued on). Read off the same seed-deterministic heightfield the
   * treeline uses, so placement stays pure.
   */
  slope?: Record<string, SlopeBand>;
  /**
   * Per-kind BARE-GROUND cull strength in [0,1] (see `render/dust-mask.ts`): the shader
   * paints dry, patchy cells as bare dust/pebbles from moisture + its own noise — a signal
   * the slope gate never sees — so lush cover used to sprout from painted scree. A kind
   * listed here survives a cell with probability `1 − strength·dust01`; strength 1 means
   * fully faded out wherever the ground paints bare. Leave rocks unlisted (scree is
   * exactly where loose stone belongs), and leave arid-biome flora (cactus, scrub)
   * unlisted — dust is their home ground.
   */
  dust?: Record<string, number>;
}

/** Smooth acceptance in [0,1]: 1 below the band, ramping linearly to 0 at `max`. */
function bandAccept(value: number, max: number, band: number): number {
  const lo = max - Math.max(0.01, band);
  if (value <= lo) return 1;
  if (value >= max) return 0;
  return (max - value) / (max - lo);
}

/** Smooth treeline acceptance in [0,1] for a cell height against a species band. */
function altitudeAccept(heightM: number, band: AltitudeBand): number {
  return bandAccept(heightM, band.maxHeightM, band.bandM ?? band.maxHeightM * 0.15);
}

/** Smooth steepness acceptance in [0,1] for a cell slope against a species band. */
function slopeAccept(slopeM: number, band: SlopeBand): number {
  return bandAccept(slopeM, band.maxSlopeM, band.bandM ?? band.maxSlopeM * 0.4);
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

  // TREELINE + SLOPE GATE: fetch the seed-deterministic base heightfield ONCE (memoised)
  // so a per-species altitude ceiling can thin canopy toward the treeline and a per-species
  // steepness ceiling can keep rocks/cover off cliff faces. Skipped when neither band is
  // declared (zero cost) or on the flat studio ground (no real relief).
  const m = ctx.tiles;
  const useField = (!!params.altitude || !!params.slope) && !m.flatHeight;
  const heightField = useField
    ? getHeightfield(m.seed, m.width, m.height, styledIslandSpec(m.worldSeed), m.worldSeed?.pois ?? null, styledShapeSpec(m.worldSeed))
    : null;
  const reliefM = useField ? worldStyleOf(m.worldSeed).mountainRelief : 0;
  const heightMAt = (x: number, y: number): number =>
    heightField ? (heightField[y * m.width + x] - ELEVATION_SEA_LEVEL) * reliefM : 0;
  // ONE slope definition, shared with biome classification (`siteMetrics`) — a second
  // one would be a second chance to disagree about what "steep" is.
  const slopeMAt = (x: number, y: number): number =>
    heightField ? siteMetrics(heightField, x, y, m.width, m.height, ELEVATION_SEA_LEVEL, reliefM).slopeM : 0;
  // BARE-GROUND GATE: the CPU mirror of the shader's dust/pebble splat weight. Climate
  // fields fetched ONCE (memoised; flat studio ground reads as never-bare).
  const dustFields = params.dust && !m.flatHeight ? getClimateFields(m) : null;
  const dustWAt = (x: number, y: number): number =>
    dustFields ? dust01(dustFields.moisture[y * m.width + x] ?? 0.5, x + 0.5, y + 0.5) : 0;

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
        // Steepness: a rock cannot rest on a cliff face; cover cannot root on one.
        const sBand = params.slope?.[kind];
        if (sBand) {
          const accept = slopeAccept(slopeMAt(x, y), sBand);
          if (accept < 1 && hash01(x, y, s + 9) >= accept) continue;
        }
        // Bare ground: lush cover fades out where the shader paints dust/pebbles.
        const dStr = params.dust?.[kind];
        if (dStr) {
          const cull = dStr * dustWAt(x, y);
          if (cull > 0 && hash01(x, y, s + 11) < cull) continue;
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
        // T4: bake this plant's colour into the ground wash (scale-weighted —
        // see `accumulateFloraTint`), so the cell's coloration survives once
        // the billboard itself culls at zoom-out/low px.
        accumulateFloraTint(m, x + fx, y + fy, kind, scale);
      }

      // Undergrowth: at most one per cell. Historically canopy-gated; the
      // `openUndergrowth` fraction lets a share grow in clearings/open cells so
      // flowers/ferns exist somewhere the player can actually see them.
      const ugScale = placedPrimary ? 1 : openUndergrowth;
      if (ugScale > 0 && params.undergrowth) {
        for (const [ugKind, ugWeight, ugDensity] of params.undergrowth) {
          const ugRng = hash01(x, y, seed + 10 + ugKind.length);
          // The undergrowth layer takes the same steepness gate as the canopy: a dwarf
          // shrub on a vertical face reads exactly as glued-on as a boulder does.
          const ugSlope = params.slope?.[ugKind];
          if (ugSlope) {
            const accept = slopeAccept(slopeMAt(x, y), ugSlope);
            if (accept < 1 && hash01(x, y, seed + 23) >= accept) continue;
          }
          // Bare ground: same dust fade as the canopy — flowers off the painted scree.
          const ugDust = params.dust?.[ugKind];
          if (ugDust) {
            const cull = ugDust * dustWAt(x, y);
            if (cull > 0 && hash01(x, y, seed + 24) < cull) continue;
          }
          if (ugRng < ugDensity * ugScale) {
            const ugKindPicked = pickWeighted(ugRng, [[ugKind, ugWeight]]);
            const ugFx = cellFrac(hash01(x, y, seed + 20), 0.35);
            const ugFy = cellFrac(hash01(x, y, seed + 21), 0.35);
            const ugScaleVal = 0.6 + hash01(x, y, seed + 22) * 0.4; // Smaller scale: 0.6-1.0
            out.push(defaultEntity(params.brush, ugKindPicked, x + ugFx, y + ugFy, {
              offsetX: ugFx,
              offsetY: ugFy,
              scale: ugScaleVal,
            }));
            // T4: undergrowth (ferns/flowers/heather) contributes its colour too.
            accumulateFloraTint(m, x + ugFx, y + ugFy, ugKindPicked, ugScaleVal);
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
