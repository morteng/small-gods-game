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
import { fbm } from '@/core/noise';

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
   * REGION-FILL target [0,1] (temperature/moisture only). When a climate-zone POI
   * stamps its `region`, a `target` makes the field LERP TOWARD this value
   * (`f = lerp(f, target, w)`) instead of adding `delta`. This OVERRIDES the global
   * gradient + elevation lapse, so "this region IS a desert" actually holds: a
   * `temperature` target of 0.90 clears the desert biome's 0.80 threshold no matter
   * how cold the base latitude is. Additive `delta` can't guarantee a threshold
   * (cold base + lapse ate the Sunscorch's +0.40 → it read as scrubland). The disc
   * (point) path ignores `target` and still uses `delta`.
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
const SIZE_SCALE: Record<string, number> = { small: 0.75, medium: 1.0, large: 1.5, huge: 2.0 };

/** Spatial frequency of the outline-warp noise (lower = broader bays/headlands). */
const WARP_FREQ = 0.07;

export interface AffectedRegion {
  x0: number; y0: number;
  x1: number; y1: number;
}

// ─── Influence table ──────────────────────────────────────────────────────────

export const POI_INFLUENCES: Record<string, InfluenceSpec> = {
  // Lake: strongly suppress elevation (to reliably go below sea level) + moisture boost
  lake:     { elevation: { delta: -0.55, radius: 10 }, moisture: { delta: +0.45, radius: 18 }, warp: 0.40 },
  // Mountain: PEAK mode — raise toward a near-ceiling summit as a true point, so
  // the centre is a sharp peak with ridge texture on the flanks, NOT the old
  // additive-disc mesa that flattened against the [0,1] clamp. `huge` widens the
  // massif; the warp breaks the rim into spurs.
  mountain: { elevation: { summit: 0.99, radius: 16 }, temperature: { delta: -0.20, radius: 16 }, warp: 0.45 },
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
  // Volcano: PEAK mode — a steep cinder cone; hot.
  volcano:  { elevation: { summit: 0.95, radius: 10 }, temperature: { delta: +0.25, radius: 16 }, warp: 0.40 },
  // Glacier: PEAK mode to a high-but-not-summit ice dome (clears the ICE
  // threshold elev > 0.65); the strong cold delta makes it ice, not bare rock.
  glacier:  { elevation: { summit: 0.90, radius: 10 }, temperature: { delta: -0.55, radius: 14 }, warp: 0.45 },
  oasis:    { moisture:  { delta: +0.70, radius:  8, target: 0.78 }, temperature: { delta: -0.05, radius:  6 }, warp: 0.35, regionFill: true },
  // Settlement types — light terrain adjustments only
  village:  {},
  city:     {},
  castle:   {},
  farm:     { moisture: { delta: +0.08, radius: 5 } },
  temple:   {},
  port:     { moisture: { delta: +0.20, radius: 8 } },
  // Plains/steppe: dry the ground enough to clear forest into open grassland over a
  // broad radius, slightly warmer (a wind-scoured steppe, not woodland). Only POIs
  // with a `position` exert influence, so a region-only meadow stays base noise.
  // Steppe/meadow: dry open grassland. moisture→0.30 (in the grassland band, out of
  // forest), temp→0.52 (lifts spurious lowland tundra to grassland; can't melt the
  // parts that sit on actual mountain — elevation > 0.76 forces Mountain biome).
  plains:   { moisture: { delta: -0.30, radius: 15, target: 0.30 }, temperature: { delta: +0.10, radius: 15, target: 0.52 }, regionFill: true },
  ruins:    {},
  tower:    {},
  mine:     {},
  tavern:   {},
};

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
  const { width, height, seed } = config;

  for (const poi of pois) {
    const spec = POI_INFLUENCES[poi.type];
    if (!spec) continue;
    const region = poi.region;
    // A region-fill type with a region needs no position; everything else (and
    // PEAK fields) still requires a point. Skip only when neither is usable.
    const canRegion = !!(spec.regionFill && region);
    if (!poi.position && !canRegion) continue;

    const px = poi.position?.x ?? 0;
    const py = poi.position?.y ?? 0;
    const scale = SIZE_SCALE[poi.size ?? 'medium'] ?? 1.0;
    const warp = spec.warp ?? 0;

    // Climate (temperature/moisture) is AREAL — it fills the region. Landform
    // (elevation: peaks, dips) is LOCAL — it stays a point disc/peak even for a
    // region-fill type, so a swamp's −0.15 dip doesn't sink its whole box below sea.
    const stampClimate = (field: Float32Array, inf: FieldInfluence | undefined): void => {
      if (!inf) return;
      if (canRegion) {
        applyFieldInfluenceRegion(field, inf, region!, width, height, seed, warp);
      } else if (poi.position) {
        applyFieldInfluence(field, inf, px, py, width, height, seed, scale, warp);
      }
    };

    // Elevation is always a point feature (or skipped for a region-only POI).
    if (poi.position) {
      applyFieldInfluence(fields.elevation, spec.elevation, px, py, width, height, seed, scale, warp);
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
      if (summit !== undefined) {
        // PEAK mode: raise toward the summit, weighted so the apex is a POINT
        // (w = 1 only at the exact centre) and steep enough that no flat mesa
        // forms. max() keeps any base ridge spikes that already top the lerp, so
        // the flanks keep their texture instead of becoming a smooth cone.
        const w = Math.pow(Math.cos((d / radius) * (Math.PI / 2)), 1.6);
        const cur = field[idx];
        const raised = cur + (summit - cur) * w;
        if (raised > cur) field[idx] = raised > 1 ? 1 : raised;
      } else {
        // Cosine falloff: full influence at center, 0 at edge
        const t = Math.cos((d / radius) * (Math.PI / 2));
        field[idx] = Math.max(0, Math.min(1, field[idx] + delta * t));
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
