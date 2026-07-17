/**
 * POI Influence System
 *
 * POIs modify the base noise fields with additive deltas and radial falloff.
 * Moving a POI → recompute union of old/new affected regions → reclassify
 * biomes → resample tiles → update blob map + entities.
 *
 * For a radius-15 POI: ~900 tiles touched, <2ms recompute time.
 */

import type { TerrainField, TerrainConfig, POI } from '@/core/types';
import { generateTerrainFields } from './terrain-generator';
import { fbm, ridgeNoise } from '@/core/noise';

// ─── Types ────────────────────────────────────────────────────────────────────

interface FieldInfluence {
  delta?: number;   // additive to field value (clamped to [0,1])
  radius: number;   // falloff radius in tiles (cosine profile)
  /**
   * PEAK mode (elevation only). When set, the field is RAISED TOWARD this summit
   * value instead of having a flat disc added: `f = lerp(f, summit, w)` where the
   * weight `w` is 1 only at the exact centre and falls off steeply. This keeps the
   * apex a true point (not a saturated mesa flattened against the [0,1] ceiling —
   * the old additive `delta` disc on already-high domed ground produced a wide
   * flat-topped mountain) while preserving the base ridge/noise texture on the
   * flanks via a max(). `summit ≤ 1`, so no clamp plateau forms.
   */
  summit?: number;
  /**
   * How much `size` grows the SUMMIT, not just the radius (summit mode only).
   * `summitEff = summit + summitSizeBoost × (sizeScale − 1)` — so a `huge`
   * volcano (scale 2) is genuinely TALLER, not merely wider, while `medium`
   * seeds stay byte-identical. Clamped to 0.99.
   */
  summitSizeBoost?: number;
  /**
   * PEAK falloff exponent (summit mode only). The summit weight is
   * `w = cos((d/r)·π/2)^peakSharpness`. The default `1.6` is a broad dome; higher
   * values concentrate the high ground near the centre and steepen the upper
   * slopes, so a large massif reads as a HORN with a foothill skirt rather than a
   * pancake smeared flat across its whole radius. Only meaningful with `summit`.
   */
  peakSharpness?: number;
  /**
   * PLATEAU / MESA mode (elevation only) — the cliff/tableland maker. Unlike
   * `summit` (a point cone that tapers to its apex), `plateau` raises a whole AREA
   * to a FLAT top at this elevation: weight is 1 across the inner `plateauCore`
   * fraction of the radius, then drops over a steep rim. Crucially it is GATED TO
   * LAND — sea cells are never raised — so when the disc is anchored on a coast the
   * existing waterline stays put and the raised tableland meets the water in a
   * one-tile drop: a SHEER CLIFF FACE, not a cone whose base fills the sea into a
   * gentle slope. That land-gate is the whole reason a cliff reads as a cliff. Keep
   * `plateau` below the 19 m mountain line (≈0.69 at demo relief) to hold a green
   * brink; the sheer face goes rocky on its own (steep slope ⇒ rock). `plateau ≤ 1`.
   */
  plateau?: number;
  /** Fraction of the radius that stays at FULL plateau height before the rim drop
   *  begins (default 0.5). Larger = a broader flat tableland, narrower rim. */
  plateauCore?: number;
  /** Rim-drop steepness exponent (plateau mode, default 1). Higher concentrates the
   *  fall into a shorter band near the outer edge — a more abrupt escarpment. */
  rimSharpness?: number;
  /**
   * PEAK silhouette: `'dome'` (default) is a rounded `cos^k` top — right for ice
   * caps and for cinder cones that carry a crater rim; `'horn'` is a pointed
   * `(1−t)^k` apex with a non-zero summit slope, so a great mountain rises to a
   * sheer point instead of a broad pancake. Only meaningful with `summit`.
   */
  peakProfile?: 'dome' | 'horn';
  /**
   * SUMMIT CRATER depth in normalised elevation (volcano/caldera). When > 0 the
   * inner `craterFrac` of the radius is a bowl: the apex dips to `summit − crater`
   * and the rim climbs back to `summit`, giving a cinder-cone silhouette instead
   * of a plain dome. The crater floor still raises toward a depressed target — it
   * never carves below the surrounding base ground. Only with `summit`.
   */
  crater?: number;
  /** Crater radius as a fraction of `radius` (default 0.22). Only with `crater`. */
  craterFrac?: number;
  /**
   * SETTLEMENT GROUND-EASING (elevation only) — the inverse of `summit`: ground
   * ABOVE this level is lerped DOWN toward it (cosine-weighted, warped edge),
   * ground at or below it is untouched. The live game generates from a random
   * seed (`Date.now()`), so noise sometimes rolls a mountain under an authored
   * village — every tile unbuildable, the settlement silently empty. A gentle
   * `cap` guarantees a livable pocket (a cleared shelf in the hillside) wherever
   * people are authored to live, while low-ground worlds stay byte-identical.
   * Keep caps under the 19 m mountain line (≈0.69 at demo relief).
   */
  cap?: number;
  /**
   * CRAG amplitude [0,1] (summit mode). Corrugates the raised mass with ridged
   * noise so a massif breaks into spurs and gullies — a craggy horn — instead of a
   * smooth radial dome (the "potato" tell: concentric gradient rings, zero
   * ridgelines). On a crest the full lift survives; in a gully up to `crag` of it
   * is shaved. Tapered to ZERO at the apex (the summit stays a clean point) and
   * ramped in over the flanks, so the spurs radiate from the peak down to the
   * foothill skirt. Only meaningful with `summit`.
   */
  crag?: number;
  /** Crag ridge frequency as a multiple of `elevationScale` (default 3.5 → a
   *  handful of spurs across a large massif). Only with `crag`. */
  cragFreq?: number;
  /**
   * REGION-FILL target [0,1] (temperature/moisture only). When a climate-zone POI
   * stamps its `region`, a `target` makes the field LERP TOWARD this value
   * (`f = lerp(f, target, w)`) instead of adding `delta`. This OVERRIDES the global
   * gradient + elevation lapse, so "this region IS a desert" actually holds: a
   * `temperature` target of 0.90 clears the desert biome's 0.80 threshold no matter
   * how cold the base latitude is. Additive `delta` can't guarantee a threshold
   * (cold base + lapse ate the Sunscorch's +0.40 → it read as scrubland). The
   * disc (point) path honours `target` the same way (lerp weighted by the cosine
   * falloff), so a point volcano can guarantee a scorching summit.
   */
  target?: number;
}

interface InfluenceSpec {
  elevation?:   FieldInfluence;
  moisture?:    FieldInfluence;
  temperature?: FieldInfluence;
  /**
   * Outline-warp amplitude [0,1]. When > 0 the falloff edge is perturbed by a
   * seeded, terrain-correlated noise field so the feature reads as an irregular
   * natural blob (a lake/mountain/swamp with bays and headlands) instead of a
   * clean disc. The effective radius varies by ±`warp × radius` per location.
   * `0` (default) keeps the exact cosine disc — settlements stay circular.
   */
  warp?: number;
  /**
   * CLIMATE-ZONE types (desert, steppe, swamp, forest…): when a POI of this type
   * carries an authored `region` box, stamp its delta fields across the WHOLE
   * region (feathered, warped edge) instead of a small point+radius disc. This is
   * the W-A fix: a 48×48 "Sunscorch desert" region was only getting a ~12-tile
   * warm disc, so its authored identity ("every clime" island) was lost to the
   * global temperate gradient. `summit`/PEAK fields (mountain/volcano/glacier
   * apex) stay POINT features even with a region — a range has a peak, not a
   * uniformly-raised rectangle. A region-only POI (no `position`) used to be
   * skipped entirely; with `regionFill` it finally exerts its climate.
   */
  regionFill?: boolean;
}

/** Per-POI `size` → radius/influence multiplier. `medium` (and unset) = 1.0, so
 *  existing seeds are unchanged unless they ask to be bigger or smaller. */
export const SIZE_SCALE: Record<string, number> = { small: 0.75, medium: 1.0, large: 1.5, huge: 2.0 };

/** Spatial frequency of the outline-warp noise (lower = broader bays/headlands). */
const WARP_FREQ = 0.07;

/** POI types whose landform must sit ON the coast — their influence centre snaps to
 *  the nearest shoreline before stamping (see `snapToCoast`). A fixed coord can't
 *  track the seed-varied coastline, so without this they land inland. */
const COASTAL_SNAP: ReadonlySet<string> = new Set(['cliffs', 'sea_stacks', 'cove', 'headland']);

/** How far (tiles) to hunt for a shoreline before giving up and using the raw point.
 *  Generous so a feature nominally placed in the offshore margin still finds its
 *  shore (the coastline wobbles tens of tiles between terrain seeds). */
const COAST_SNAP_RADIUS = 80;

/**
 * Snap (px,py) to the nearest LAND cell that borders open water (a true shoreline),
 * searching outward in a bounded square spiral. Deterministic (fixed scan order, no
 * RNG). Returns the original point if already coastal or no coast is within
 * `COAST_SNAP_RADIUS`. This is what makes a coastal feature attach to the real coast
 * instead of a fixed coordinate that the terrain seed may have left inland.
 */
function snapToCoast(
  elevation: Float32Array, px: number, py: number, width: number, height: number, seaLevel: number,
): { x: number; y: number } {
  const inB = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height;
  const isSea = (x: number, y: number) => !inB(x, y) || elevation[y * width + x] < seaLevel;
  const isShore = (x: number, y: number) => {
    if (!inB(x, y) || elevation[y * width + x] < seaLevel) return false;   // must be land
    return isSea(x - 1, y) || isSea(x + 1, y) || isSea(x, y - 1) || isSea(x, y + 1);
  };
  if (isShore(px, py)) return { x: px, y: py };
  for (let r = 1; r <= COAST_SNAP_RADIUS; r++) {
    // scan the ring at Chebyshev distance r; nearest-first by construction
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;   // ring only
        if (isShore(px + dx, py + dy)) return { x: px + dx, y: py + dy };
      }
    }
  }
  return { x: px, y: py };
}

const COAST_DIRS: Record<string, [number, number]> = {
  east: [1, 0], west: [-1, 0], north: [0, -1], south: [0, 1],
};

/**
 * Resolve a coastal feature to the REAL shoreline along a compass direction. Walks
 * the full grid line through (px,py) in `dir`, collecting every land cell whose
 * neighbour one step further `dir` is open water (a coast that FACES that way), and
 * returns the one nearest the nominal point. This is the seed-proof alternative to a
 * fixed coordinate: "the cliffs on the EAST shore" lands on whatever the east shore
 * actually is this world. Falls back to `snapToCoast` (nearest) if the line meets no
 * such coast.
 */
function resolveCoastAnchor(
  elevation: Float32Array, px: number, py: number, dir: string, width: number, height: number, seaLevel: number,
): { x: number; y: number } {
  const v = COAST_DIRS[dir];
  if (!v) return snapToCoast(elevation, px, py, width, height, seaLevel);
  const inB = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height;
  const isSea = (x: number, y: number) => !inB(x, y) || elevation[y * width + x] < seaLevel;
  const span = Math.max(width, height);
  let best: { x: number; y: number } | null = null;
  let bestDist = Infinity;
  for (let t = -span; t <= span; t++) {
    const x = px + v[0] * t, y = py + v[1] * t;
    if (!inB(x, y)) continue;
    if (elevation[y * width + x] < seaLevel) continue;             // land only
    if (!isSea(x + v[0], y + v[1])) continue;                       // facing the sea in `dir`
    const d = Math.abs(t);
    if (d < bestDist) { bestDist = d; best = { x, y }; }
  }
  return best ?? snapToCoast(elevation, px, py, width, height, seaLevel);
}

/** Deterministic [0,1) hash of two ints (no Math.random — terrain gen must be
 *  reproducible). xxhash-ish mix via Math.imul. */
function hash01(a: number, b: number): number {
  let h = Math.imul((a | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((b | 0) + 0x165667b1, 0xc2b2ae35);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/** Unit vector from a shore land cell toward the open water beside it (averaged
 *  over the 8 neighbours that are sea). Gives the SEAWARD direction so offshore
 *  features (sea stacks) step out into the water, not back inland. */
function seawardDir(
  elev: Float32Array, x: number, y: number, width: number, height: number, seaLevel: number,
): [number, number] {
  let sx = 0, sy = 0;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
    const nx = x + dx, ny = y + dy;
    const isSea = nx < 0 || ny < 0 || nx >= width || ny >= height || elev[ny * width + nx] < seaLevel;
    if (isSea) { sx += dx; sy += dy; }
  }
  const len = Math.hypot(sx, sy) || 1;
  return [sx / len, sy / len];
}

/** Raise one small, sharp rocky islet (a sea stack) centred at (cx,cy). GATED TO
 *  SEA — only cells currently below the waterline are lifted, so the stack rises
 *  ISOLATED from the water rather than fusing into the shore. A tight horn apex +
 *  steep flanks make the slope blow past ROCK_SLOPE_M, so it classifies as bare
 *  rock poking from the surf. */
function raiseIslet(
  elev: Float32Array, cx: number, cy: number, width: number, height: number,
  seaLevel: number, summit: number, radius: number,
): void {
  const x0 = Math.max(0, Math.floor(cx - radius)), x1 = Math.min(width - 1, Math.ceil(cx + radius));
  const y0 = Math.max(0, Math.floor(cy - radius)), y1 = Math.min(height - 1, Math.ceil(cy + radius));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const idx = y * width + x;
      if (elev[idx] >= seaLevel) continue;                 // sea-only → an isolated stack
      const d = Math.hypot(x - cx, y - cy);
      if (d >= radius) continue;
      const w = Math.pow(1 - d / radius, 1.5);              // pointed horn apex
      const raised = elev[idx] + (summit - elev[idx]) * w;
      if (raised > elev[idx]) elev[idx] = raised > 1 ? 1 : raised;
    }
  }
}

/** Scatter a seeded cluster of sea stacks in the water just off a shore anchor.
 *  Stepped seaward with lateral jitter so they read as a natural row of pillars
 *  off a headland — the iconic companion to a cliff coast. Deterministic. */
function placeSeaStacks(
  elev: Float32Array, ax: number, ay: number, width: number, height: number,
  seaLevel: number, seed: number, scale: number,
): void {
  const sw = seawardDir(elev, ax, ay, width, height, seaLevel);
  const perp: [number, number] = [-sw[1], sw[0]];
  const n = Math.round(3 + 2 * scale);                     // ~3 (small) … 5 (large)
  for (let i = 0; i < n; i++) {
    const fwd = 2.5 + i * 2.2 + hash01(seed + i, 11) * 2.5;       // step out into the surf
    const lat = (hash01(seed + i, 23) - 0.5) * 9;                 // jitter along the shore
    const cx = Math.round(ax + sw[0] * fwd + perp[0] * lat);
    const cy = Math.round(ay + sw[1] * fwd + perp[1] * lat);
    const summit = 0.40 + hash01(seed + i, 37) * 0.06;            // ~2.7–6 m above sea
    const radius = 2.0 + hash01(seed + i, 53) * 1.5;             // small pillars
    raiseIslet(elev, cx, cy, width, height, seaLevel, summit, radius);
  }
}

export interface AffectedRegion {
  x0: number; y0: number;
  x1: number; y1: number;
}

// ─── Influence table ──────────────────────────────────────────────────────────

export const POI_INFLUENCES: Record<string, InfluenceSpec> = {
  // Lake: a SHALLOW basin that ponds and perches on its local water table, + moisture
  // boost. The old −0.55 (−33 m) sink "reliably went below sea level" — but that dug a
  // deep pit whose spill, on near-sea ground, sat at the OCEAN datum, so an inland lake
  // rendered as a sea-level puddle in a hole. A shallow −0.16 dip keeps the basin floor
  // above sea on normal upland ground, so hydrology's pit-fill ponds it to a spill lip
  // ABOVE sea and the surface perches (measured: ~95% of formed lakes perch vs 0% at
  // −0.55, same lake count, ~2–3 m deep). Lakes that can't enclose a basin simply don't
  // form there — better than an ugly sub-sea pit. Surface fill stays hydrology's job.
  lake:     { elevation: { delta: -0.16, radius: 10 }, moisture: { delta: +0.45, radius: 18 }, warp: 0.40 },
  // Mountain: PEAK mode — raise toward a near-ceiling summit as a true point, so
  // the centre is a sharp peak with ridge texture on the flanks, NOT the old
  // additive-disc mesa that flattened against the [0,1] clamp. `peakSharpness`
  // steepens the cone so a `huge` massif (radius ×2) reads as a HORN rising out of
  // a foothill skirt rather than a broad pancake smeared over 60+ tiles. The warp
  // breaks the rim into spurs.
  mountain: { elevation: { summit: 0.99, radius: 18, peakProfile: 'horn', peakSharpness: 1.7, crag: 0.6, cragFreq: 3.5 }, temperature: { delta: -0.30, radius: 22 }, warp: 0.45 },
  // Forest: moisture boost pushes toward forest biomes. region-fill so an authored
  // forest BELT (e.g. Whispering Woods — a region with NO position, previously
  // skipped) actually moistens its whole extent into woodland; a moisture target of
  // 0.62 clears the forest threshold while latitude decides boreal vs temperate.
  forest:   { moisture:  { delta: +0.35, radius: 12, target: 0.62 }, warp: 0.30, regionFill: true },
  // Swamp: a HOT wet lowland (the biome model only has a tropical-style swamp:
  // temp ≥ 0.80 & moisture > 0.70). region-fill temp+moisture toward those; the
  // elevation DIP stays a POINT feature (a region-wide −0.15 sank Murkmire's whole
  // box below sea level → 30% ocean).
  swamp:    { elevation: { delta: -0.15, radius:  8 }, moisture: { delta: +0.55, radius: 10, target: 0.82 }, temperature: { delta: +0.10, radius: 10, target: 0.84 }, warp: 0.45, regionFill: true },
  // Desert: lerp temp→0.90 (clears the 0.80 desert threshold against the cold
  // european base + lapse — an additive +0.40 left it as scrubland) and moisture→0.10
  // (under the 0.25 dry cap), across the authored 48×48 Sunscorch.
  desert:   { moisture:  { delta: -0.55, radius: 14, target: 0.10 }, temperature: { delta: +0.40, radius: 12, target: 0.90 }, warp: 0.50, regionFill: true },
  // Volcano: PEAK mode — a steep cinder cone with a summit crater, so it reads as a
  // volcano and not a smooth hill: sharp falloff (`peakSharpness`) for the cone
  // flanks + a `crater` bowl that dips the apex below its rim.
  //
  // Identity comes from HEAT, not a height cap: the temperature lerps toward
  // scorching (target 0.95) across the cone, and `classifyBiome` claims hot
  // mountain-height ground as the VOLCANIC biome (dark basalt/ash) before the
  // alpine Peak/snow branch can touch it — so the summit may now grow with `size`
  // (summitSizeBoost: a `huge` volcano reaches 0.88 ≈ 29 m at demo relief, still
  // under the 0.99 Cloudwall) without painting itself a snow cap. The moisture
  // target ~0 parches the flanks so forest brushes leave the ash bare.
  volcano:  { elevation: { summit: 0.80, summitSizeBoost: 0.08, radius: 14, peakSharpness: 2.8, crater: 0.18, craterFrac: 0.20 }, temperature: { delta: +0.45, radius: 18, target: 0.95 }, moisture: { delta: -0.5, radius: 16, target: 0.08 }, warp: 0.40 },
  // Glacier: PEAK mode to a high-but-not-summit ice dome (clears the ICE
  // threshold elev > 0.65); the strong cold delta makes it ice, not bare rock.
  glacier:  { elevation: { summit: 0.90, radius: 10 }, temperature: { delta: -0.55, radius: 14 }, warp: 0.45 },
  oasis:    { moisture:  { delta: +0.70, radius:  8, target: 0.78 }, temperature: { delta: -0.05, radius:  6 }, warp: 0.35, regionFill: true },
  // Cliffs: an AGENT-AUTHORABLE coastal feature — "the dire cliffs to the east".
  // PLATEAU mode raises the WHOLE coastal AREA to a flat tableland (plateau 0.64 ≈
  // 16 m above sea at demo relief, kept BELOW the 19 m mountain line so the brink
  // stays a green clifftop). Because the plateau is GATED TO LAND, the existing
  // waterline stays put and the tableland plunges to it in one tile — a sheer face
  // whose slope blows past CLIFF_SLOPE_M, so the emergent coast classifier renders
  // it as `Cliff` (rock plunging to the surf) with REAL height for drama. This is
  // the fix for the old `summit` cone, which raised the sea too and read as a lone
  // rocky hill at the shore. `warp` breaks the cliff line into bays and headlands;
  // light `crag` ruggeds the brink. An agent/recipe drops a `cliffs` POI (+ a
  // `coast` direction) on the shore it wants dramatised.
  cliffs:   { elevation: { plateau: 0.64, radius: 14, plateauCore: 0.52, rimSharpness: 1.7, crag: 0.32, cragFreq: 4.0 }, temperature: { delta: -0.05, radius: 14 }, warp: 0.4 },
  // Sea stacks: an AGENT-AUTHORABLE offshore landform — a row of bare rock pillars
  // rising from the surf just off a headland, the iconic companion to the cliffs.
  // No standard field influence (the empty spec just keeps it out of the skip
  // branch); the offshore islet cluster is placed bespoke in applyPoiInfluences via
  // `placeSeaStacks` (coast-anchored, stepped seaward, sea-gated). `size` scales the
  // count (~3 small … 5 large). Drop a `sea_stacks` POI (+ a `coast` direction) on
  // the shore you want studded with stacks.
  sea_stacks: {},
  // Cove: an AGENT-AUTHORABLE sheltered inlet — a rounded basin carved at the shore
  // so the sea floods IN, biting a concave bay into the coastline with land arms to
  // either side (where the dip falloff is weak). Reuses the negative-`delta` dip path
  // + the coast anchor; `warp` makes the mouth irregular. A touch of moisture greens
  // the sheltered shore. Drop a `cove` POI (+ `coast`) on the shore you want indented.
  cove:     { elevation: { delta: -0.26, radius: 9 }, moisture: { delta: +0.12, radius: 11 }, warp: 0.5 },
  // Headland: an AGENT-AUTHORABLE low green CAPE projecting into the sea — the gentle
  // cousin of the dire cliffs. PLATEAU mode (land-gated) but lower and softer-rimmed
  // (plateau 0.50 ≈ 8 m, a rounded brow, not a 16 m sheer wall), so it reads as a
  // grassy promontory with a rocky toe rather than an alpine crag. Drop a `headland`
  // POI (+ `coast`) on the shore you want to bulge out into a cape.
  headland: { elevation: { plateau: 0.50, radius: 12, plateauCore: 0.42, rimSharpness: 1.1, crag: 0.22, cragFreq: 3.5 }, temperature: { delta: -0.03, radius: 12 }, warp: 0.5 },
  // Settlement types — GROUND-EASING (`cap`, lower-only): the live game rolls a
  // random gen seed, so noise sometimes puts a mountain under an authored town and
  // every tile is unbuildable (probe-world's `settlement.unbuilt`). A gentle cap
  // guarantees a livable pocket; low-lying sites are untouched (cap never raises).
  // Caps sit under the 19 m mountain line (0.69); tower/castle keep more of a rise.
  village:  { elevation: { cap: 0.66, radius: 12 }, warp: 0.35 },
  city:     { elevation: { cap: 0.66, radius: 16 }, warp: 0.35 },
  castle:   { elevation: { cap: 0.68, radius: 8 },  warp: 0.3 },
  farm:     { elevation: { cap: 0.62, radius: 12 }, moisture: { delta: +0.08, radius: 5 }, warp: 0.35 },
  temple:   { elevation: { cap: 0.66, radius: 8 },  warp: 0.3 },
  port:     { elevation: { cap: 0.62, radius: 8 },  moisture: { delta: +0.20, radius: 8 }, warp: 0.3 },
  // Plains/steppe: dry the ground enough to clear forest into open grassland over a
  // broad radius, slightly warmer (a wind-scoured steppe, not woodland). Only POIs
  // with a `position` exert influence, so a region-only meadow stays base noise.
  // Steppe/meadow: dry open grassland. moisture→0.30 (in the grassland band, out of
  // forest), temp→0.52 (lifts spurious lowland tundra to grassland; can't melt the
  // parts that sit on actual mountain — elevation > 0.76 forces Mountain biome).
  plains:   { moisture: { delta: -0.30, radius: 15, target: 0.30 }, temperature: { delta: +0.10, radius: 15, target: 0.52 }, regionFill: true },
  ruins:    { elevation: { cap: 0.70, radius: 5 }, warp: 0.3 },
  tower:    { elevation: { cap: 0.70, radius: 5 }, warp: 0.3 },  // a watch site keeps its rise
  mine:     { elevation: { cap: 0.68, radius: 5 }, warp: 0.3 },  // a worked terrace at the shaft mouth
  tavern:   { elevation: { cap: 0.66, radius: 6 }, warp: 0.3 },
};

/** POI types whose `region` box exerts field influence (everything else treats
 *  `region` as layout metadata only — the seed validator warns about that). */
export const REGION_FILL_POI_TYPES: readonly string[] =
  Object.entries(POI_INFLUENCES).filter(([, s]) => s.regionFill).map(([t]) => t);

/** POI types that stamp NO terrain influence at all (settlements etc. — their
 *  expression is buildings/zones, not fields). Used by the seed doctor to tell
 *  "type is terrain-inert by design" from "type was skipped by a typo". */
export const FIELD_INERT_POI_TYPES: readonly string[] =
  Object.entries(POI_INFLUENCES)
    .filter(([, s]) => !s.elevation && !s.moisture && !s.temperature)
    .map(([t]) => t);

// ─── Apply influences ─────────────────────────────────────────────────────────

/**
 * Apply all POI influences onto the base terrain fields IN PLACE.
 * Call this after generateTerrainFields() but before classifyBiomes().
 */
export function applyPoiInfluences(
  fields: TerrainField,
  pois:   POI[],
  config: TerrainConfig,
): void {
  const { width, height, seed, elevationScale = 0.02, seaLevel = 0.35 } = config;

  for (const poi of pois) {
    // M4: runtime-created POIs (RuntimePoiStore projections, `runtime: true`) are
    // terrain-inert BY RULE — their ground expression is earthworks (the runtime-safe
    // deformation channel), never the base field. Without this guard a projected
    // runtime `castle` would move the ground under gen-time biome classification,
    // hydrology, and every standing building near the site. Twin guard:
    // `poiHeightSignature` (heightfield.ts). See src/world/runtime-poi.ts.
    if (poi.runtime) continue;
    const spec = POI_INFLUENCES[poi.type];
    if (!spec) continue;
    const region = poi.region;
    // A region-fill type with a region needs no position; everything else (and
    // PEAK fields) still requires a point. Skip only when neither is usable.
    const canRegion = !!(spec.regionFill && region);
    if (!poi.position && !canRegion) continue;

    let px = poi.position?.x ?? 0;
    let py = poi.position?.y ?? 0;
    // Coastal features attach to the REAL shoreline, not their nominal point: the
    // terrain seed varies the coast each world, so a fixed coord can land inland (a
    // hill by a river, not a sea cliff). Snap the centre to the nearest land cell that
    // borders open water before raising the escarpment, so a `cliffs` POI reliably
    // rears up out of the actual surf. No-op if the point is already coastal / no
    // coast is within reach.
    if (COASTAL_SNAP.has(poi.type) && poi.position) {
      const dir = poi.coast;
      const anchor = dir && dir !== 'nearest'
        ? resolveCoastAnchor(fields.elevation, px, py, dir, width, height, seaLevel)
        : snapToCoast(fields.elevation, px, py, width, height, seaLevel);
      px = anchor.x; py = anchor.y;
    }
    const scale = SIZE_SCALE[poi.size ?? 'medium'] ?? 1.0;
    const warp = spec.warp ?? 0;

    // Sea stacks are an OFFSHORE landform — a scattered cluster of islets in the
    // water just past the shore anchor — not a single disc/peak at the point. Handle
    // them bespoke (the standard elevation path would raise one blob on land).
    if (poi.type === 'sea_stacks' && poi.position) {
      placeSeaStacks(fields.elevation, px, py, width, height, seaLevel, seed, scale);
      continue;
    }

    // Climate (temperature/moisture) is AREAL — it fills the region. Landform
    // (elevation: peaks, dips) is LOCAL — it stays a point disc/peak even for a
    // region-fill type, so a swamp's −0.15 dip doesn't sink its whole box below sea.
    const stampClimate = (field: Float32Array, inf: FieldInfluence | undefined): void => {
      if (!inf) return;
      if (canRegion) {
        applyFieldInfluenceRegion(field, inf, region!, width, height, seed, warp);
      } else if (poi.position) {
        applyFieldInfluence(field, inf, px, py, width, height, seed, scale, warp, elevationScale, seaLevel);
      }
    };

    // Elevation is always a point feature (or skipped for a region-only POI).
    if (poi.position) {
      // Author-facing height: `size` can grow the summit (summitSizeBoost), and a
      // per-POI `summitM` (metres above sea) overrides the type's height outright —
      // the seed's ONE lever for "a taller volcano / a shorter mountain".
      let elevSpec = spec.elevation;
      if (elevSpec?.summit !== undefined) {
        const relief = config.reliefM ?? 48;
        let summit = elevSpec.summit + (elevSpec.summitSizeBoost ?? 0) * (scale - 1);
        if (poi.summitM !== undefined) summit = seaLevel + poi.summitM / relief;
        summit = Math.min(0.99, Math.max(seaLevel + 0.02, summit));
        if (summit !== elevSpec.summit) elevSpec = { ...elevSpec, summit };
      }
      applyFieldInfluence(fields.elevation, elevSpec, px, py, width, height, seed, scale, warp, elevationScale, seaLevel);
    }
    stampClimate(fields.moisture,    spec.moisture);
    stampClimate(fields.temperature, spec.temperature);
  }
}

/**
 * Stamp a delta field across an authored REGION box with a feathered, warped edge
 * (the W-A region-fill path). Full influence in the interior, a cosine ramp across
 * a feather band straddling each edge; with `warp > 0` the edge is perturbed by the
 * same seeded noise the disc path uses, so the zone reads as a natural blob, not a
 * rectangle. `summit`/PEAK fields are handled by the disc path, never here.
 */
function applyFieldInfluenceRegion(
  field:  Float32Array,
  spec:   FieldInfluence,
  region: { x_min: number; x_max: number; y_min: number; y_max: number },
  width:  number,
  height: number,
  seed:   number,
  warp:   number,
): void {
  const delta = spec.delta ?? 0;
  if (spec.summit !== undefined) return;          // PEAK fields never region-fill
  if (delta === 0 && spec.target === undefined) return;

  const rw = region.x_max - region.x_min;
  const rh = region.y_max - region.y_min;
  if (rw <= 0 || rh <= 0) return;

  // Feather band scales with the smaller side (small zones get a soft but
  // proportionate edge), clamped so big zones don't bleed for dozens of tiles.
  const feather = Math.max(4, Math.min(16, Math.min(rw, rh) * 0.3));
  const warpAmp = warp * feather * 2;       // how far the edge can wobble, in tiles
  const reach = feather + warpAmp;

  const x0 = Math.max(0, Math.floor(region.x_min - reach));
  const x1 = Math.min(width  - 1, Math.ceil(region.x_max + reach));
  const y0 = Math.max(0, Math.floor(region.y_min - reach));
  const y1 = Math.min(height - 1, Math.ceil(region.y_max + reach));

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      // Signed distance INTO the rect: positive inside, negative outside, min()
      // rounds the corners (natural, not chamfered-square).
      let dIn = Math.min(x - region.x_min, region.x_max - x,
                         y - region.y_min, region.y_max - y);
      if (warp > 0) {
        const n = fbm(x * WARP_FREQ, y * WARP_FREQ, { seed: seed + 4242, octaves: 3 });
        dIn += (n - 0.5) * 2 * warpAmp;     // shove the effective edge in/out
      }
      // Ramp 0→1 across the feather band centred on the edge (t=0.5 at the edge).
      let t = dIn / feather + 0.5;
      if (t <= 0) continue;
      if (t > 1) t = 1;
      const w = t * t * (3 - 2 * t);        // smoothstep
      const idx = y * width + x;
      const cur = field[idx];
      // target → lerp toward it (overrides the global gradient: identity holds);
      // otherwise additive delta.
      const next = spec.target !== undefined
        ? cur + (spec.target - cur) * w
        : cur + delta * w;
      field[idx] = next < 0 ? 0 : next > 1 ? 1 : next;
    }
  }
}

function applyFieldInfluence(
  field:   Float32Array,
  spec:    FieldInfluence | undefined,
  px:      number,
  py:      number,
  width:   number,
  height:  number,
  seed:    number,
  scale:   number,
  warp:    number,
  elevationScale: number = 0.02,
  seaLevel: number = 0.35,
): void {
  if (!spec) return;
  const delta = spec.delta ?? 0;
  const summit = spec.summit;
  const radius = spec.radius * scale;
  // With warp the outline can bulge OUT to (1 + warp)·radius, so the scan box
  // must be widened or headlands get clipped square.
  const reach = radius * (1 + warp);

  const x0 = Math.max(0, Math.floor(px - reach));
  const x1 = Math.min(width  - 1, Math.ceil(px + reach));
  const y0 = Math.max(0, Math.floor(py - reach));
  const y1 = Math.min(height - 1, Math.ceil(py + reach));

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - px, dy = y - py;
      let d = Math.sqrt(dx * dx + dy * dy);
      if (warp > 0) {
        // Seeded, terrain-correlated EDGE perturbation: shift the effective
        // distance by a low-freq noise sampled at the tile (so the SAME warp is
        // reproduced on every rebuild — worldgen + render heightfield agree).
        // Tapered by (d/radius) so it vanishes at the centre: the OUTLINE gets
        // bays and headlands while a peak's apex stays put and sharp (an untapered
        // warp shoves the summit off-centre and flattens it). fbm ∈ [0,1].
        const n = fbm(x * WARP_FREQ, y * WARP_FREQ, { seed: seed + 4242, octaves: 3 });
        const taper = d / radius; // 0 at centre → 1 at edge
        d -= (n - 0.5) * 2 * warp * radius * taper;
      }
      if (d >= radius) continue;
      if (d < 0) d = 0;
      const idx = y * width + x;
      if (summit !== undefined || spec.plateau !== undefined) {
        // ELEVATION-RAISE modes — raise the ground TOWARD a target, weighted by a
        // radial profile. Two families:
        //   PLATEAU/MESA (`plateau`): a FLAT top out to `plateauCore`, then a steep
        //     rim. Gated to land (sea cells skipped) so an anchored-on-coast disc
        //     leaves the waterline put and the tableland plunges to it = a CLIFF.
        //   PEAK (`summit`): a point cone — 'dome' (cos^k) or 'horn' ((1−t)^k apex).
        const t = d / radius;                                   // 0 centre → 1 edge
        const isPlateau = spec.plateau !== undefined;
        const target = isPlateau ? spec.plateau! : summit!;
        let w: number;
        if (isPlateau) {
          const core = spec.plateauCore ?? 0.5;
          if (t <= core) {
            w = 1;
          } else {
            const u = (t - core) / (1 - core);                  // 0 at core → 1 at edge
            const s = u * u * (3 - 2 * u);                      // smoothstep down
            w = 1 - s;
          }
          w = Math.pow(w, spec.rimSharpness ?? 1);
        } else {
          const prof = spec.peakProfile ?? 'dome';
          const k = spec.peakSharpness ?? (prof === 'horn' ? 1.5 : 1.6);
          w = prof === 'horn'
            ? Math.pow(1 - t, k)
            : Math.pow(Math.cos(t * (Math.PI / 2)), k);
        }
        // CRAG: corrugate the lift with ridged noise so the massif reads as a
        // craggy horn with spurs/gullies, not a smooth radial dome (the "potato").
        // ridgeNoise ≈ 1 on a crest, ≈ 0 in a trough. Crests keep full lift; a
        // trough loses up to `crag` of it. Gated by a smoothstep WINDOW on `t`:
        // the very apex tip (t<0.08) stays a clean point, then the crag ramps to
        // full by t≈0.32 and holds across the whole visible massif and flanks — so
        // the corrugation bites the brown core (the potato), not just the rim.
        if (spec.crag && spec.crag > 0) {
          const cf = (spec.cragFreq ?? 3.5) * elevationScale;
          const rn = ridgeNoise(x * cf, y * cf, seed + 1717, 4); // 0..1, ~1 crest
          const g = Math.max(0, Math.min(1, (t - 0.08) / 0.24)); // ramp 0.08→0.32
          const gate = g * g * (3 - 2 * g);                      // smoothstep
          w *= 1 - spec.crag * gate * (1 - rn);
        }
        const cur = field[idx];
        // PLATEAU keeps the coastline: never raise a sea cell. The tableland then
        // meets the unchanged waterline in a one-tile drop = a sheer cliff face,
        // instead of the sea filling up into a gentle cone base (the old "rocky
        // hill at the shore" failure). Summit/peak mode raises freely as before.
        if (isPlateau && cur < seaLevel) continue;
        let raised = cur + (target - cur) * w;
        // Summit crater (volcano/caldera): subtract a parabolic bowl over the inner
        // `craterFrac`, deepest at the apex, zero at the rim — so the rim ring stands
        // proud of the dipped floor (a cinder-cone silhouette). The `> cur` guard
        // keeps the floor at base ground at worst; it never carves below it.
        const crater = spec.crater;
        if (!isPlateau && crater !== undefined && crater > 0) {
          const cf = spec.craterFrac ?? 0.22;
          if (t < cf) { const u = t / cf; raised -= crater * (1 - u * u); }
        }
        if (raised > cur) field[idx] = raised > 1 ? 1 : raised;
      } else if (spec.cap !== undefined) {
        // GROUND-EASING: lower-only lerp toward `cap` — carve a livable pocket
        // out of whatever the noise rolled, never raise or touch low ground.
        const t = d / radius;
        const w = Math.pow(Math.cos(t * (Math.PI / 2)), 1.6);
        const cur = field[idx];
        if (cur > spec.cap && cur >= seaLevel) {
          field[idx] = cur + (spec.cap - cur) * w;
        }
      } else {
        // Cosine falloff: full influence at center, 0 at edge. `target` lerps
        // toward an absolute value (threshold-guaranteeing, same as the region
        // path); plain `delta` stays additive.
        const t = Math.cos((d / radius) * (Math.PI / 2));
        const cur = field[idx];
        const next = spec.target !== undefined ? cur + (spec.target - cur) * t : cur + delta * t;
        field[idx] = Math.max(0, Math.min(1, next));
      }
    }
  }
}

// ─── Affected region ─────────────────────────────────────────────────────────

/**
 * Returns the bounding box of tiles affected by a POI's influence spec.
 * Used for incremental recomputation after a POI moves.
 */
export function getAffectedRegion(poi: POI, config: TerrainConfig): AffectedRegion | null {
  const spec = POI_INFLUENCES[poi.type];
  if (!spec) return null;
  const { width, height } = config;

  // Region-fill type with a region: the affected box is the region, expanded by
  // the feather + warp overhang the stamp can reach.
  if (spec.regionFill && poi.region) {
    const r = poi.region;
    const feather = Math.max(4, Math.min(16, Math.min(r.x_max - r.x_min, r.y_max - r.y_min) * 0.3));
    const reach = feather * (1 + (spec.warp ?? 0) * 2);
    return {
      x0: Math.max(0, Math.floor(r.x_min - reach)),
      y0: Math.max(0, Math.floor(r.y_min - reach)),
      x1: Math.min(width  - 1, Math.ceil(r.x_max + reach)),
      y1: Math.min(height - 1, Math.ceil(r.y_max + reach)),
    };
  }

  if (!poi.position) return null;
  const px = poi.position.x, py = poi.position.y;
  const scale = SIZE_SCALE[poi.size ?? 'medium'] ?? 1.0;
  const warp = spec.warp ?? 0;

  let maxR = 0;
  for (const [key, inf] of Object.entries(spec)) {
    if (key === 'warp') continue;
    const f = inf as FieldInfluence | undefined;
    if (f && f.radius > maxR) maxR = f.radius;
  }
  if (maxR === 0) return null;
  maxR = maxR * scale * (1 + warp);

  return {
    x0: Math.max(0, Math.floor(px - maxR)),
    y0: Math.max(0, Math.floor(py - maxR)),
    x1: Math.min(width  - 1, Math.ceil(px + maxR)),
    y1: Math.min(height - 1, Math.ceil(py + maxR)),
  };
}

/**
 * Union of old and new affected regions (for a moved POI).
 */
export function unionRegions(a: AffectedRegion, b: AffectedRegion): AffectedRegion {
  return {
    x0: Math.min(a.x0, b.x0),
    y0: Math.min(a.y0, b.y0),
    x1: Math.max(a.x1, b.x1),
    y1: Math.max(a.y1, b.y1),
  };
}

/**
 * Full incremental recompute: regenerate base fields for the affected region,
 * re-apply ALL POI influences, return the updated fields.
 *
 * Because influence fields are additive from scratch, we can't just patch a
 * sub-region — we regenerate the full fields and re-apply all POIs.
 * For a 256×256 map this takes ~150ms (same as full generate).
 *
 * For truly incremental updates (sub-region only), the caller should use
 * recomputeRegion() from terrain-generator.ts on the returned fields.
 */
export function recomputeWithPois(
  pois:   POI[],
  config: TerrainConfig,
): TerrainField {
  const fields = generateTerrainFields(config);
  applyPoiInfluences(fields, pois, config);
  return fields;
}
