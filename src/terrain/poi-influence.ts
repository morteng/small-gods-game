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
  // Forest: moisture boost pushes toward forest biomes
  forest:   { moisture:  { delta: +0.35, radius: 12 }, warp: 0.30 },
  // Swamp: lower elevation slightly, very high moisture, warm
  swamp:    { elevation: { delta: -0.15, radius:  8 }, moisture: { delta: +0.55, radius: 10 }, warp: 0.45 },
  // Desert: temp delta raised to +0.40 so the DESERT biome (needs temp > 0.80)
  // actually forms at non-equatorial latitudes, not just dry scrubland.
  desert:   { moisture:  { delta: -0.55, radius: 14 }, temperature: { delta: +0.40, radius: 12 }, warp: 0.50 },
  // Volcano: PEAK mode — a steep cinder cone; hot.
  volcano:  { elevation: { summit: 0.95, radius: 10 }, temperature: { delta: +0.25, radius: 16 }, warp: 0.40 },
  // Glacier: PEAK mode to a high-but-not-summit ice dome (clears the ICE
  // threshold elev > 0.65); the strong cold delta makes it ice, not bare rock.
  glacier:  { elevation: { summit: 0.90, radius: 10 }, temperature: { delta: -0.55, radius: 14 }, warp: 0.45 },
  oasis:    { moisture:  { delta: +0.70, radius:  8 }, temperature: { delta: -0.05, radius:  6 }, warp: 0.35 },
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
  plains:   { moisture: { delta: -0.30, radius: 15 }, temperature: { delta: +0.06, radius: 15 } },
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
    if (!poi.position) continue;
    const spec = POI_INFLUENCES[poi.type];
    if (!spec) continue;

    const px = poi.position.x;
    const py = poi.position.y;
    const scale = SIZE_SCALE[poi.size ?? 'medium'] ?? 1.0;
    const warp = spec.warp ?? 0;

    applyFieldInfluence(fields.elevation,   spec.elevation,   px, py, width, height, seed, scale, warp);
    applyFieldInfluence(fields.moisture,    spec.moisture,    px, py, width, height, seed, scale, warp);
    applyFieldInfluence(fields.temperature, spec.temperature, px, py, width, height, seed, scale, warp);
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
  if (!poi.position) return null;
  const spec = POI_INFLUENCES[poi.type];
  if (!spec) return null;

  const { width, height } = config;
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
