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

// ─── Types ────────────────────────────────────────────────────────────────────

interface FieldInfluence {
  delta: number;    // additive to field value (clamped to [0,1])
  radius: number;   // falloff radius in tiles (cosine profile)
}

interface InfluenceSpec {
  elevation?:   FieldInfluence;
  moisture?:    FieldInfluence;
  temperature?: FieldInfluence;
}

export interface AffectedRegion {
  x0: number; y0: number;
  x1: number; y1: number;
}

// ─── Influence table ──────────────────────────────────────────────────────────

export const POI_INFLUENCES: Record<string, InfluenceSpec> = {
  // Lake: strongly suppress elevation (to reliably go below sea level) + moisture boost
  lake:     { elevation: { delta: -0.55, radius: 10 }, moisture: { delta: +0.45, radius: 18 } },
  // Mountain: strongly boost elevation to reach mountain/peak thresholds
  mountain: { elevation: { delta: +0.55, radius: 12 }, temperature: { delta: -0.20, radius: 14 } },
  // Forest: moisture boost pushes toward forest biomes
  forest:   { moisture:  { delta: +0.35, radius: 12 } },
  // Swamp: lower elevation slightly, very high moisture, warm
  swamp:    { elevation: { delta: -0.15, radius:  8 }, moisture: { delta: +0.55, radius: 10 } },
  desert:   { moisture:  { delta: -0.50, radius: 14 }, temperature: { delta: +0.15, radius: 12 } },
  volcano:  { elevation: { delta: +0.45, radius: 10 }, temperature: { delta: +0.25, radius: 16 } },
  glacier:  { elevation: { delta: +0.15, radius:  8 }, temperature: { delta: -0.45, radius: 14 } },
  oasis:    { moisture:  { delta: +0.65, radius:  7 }, temperature: { delta: -0.05, radius:  6 } },
  // Settlement types — light terrain adjustments only
  village:  {},
  city:     {},
  castle:   {},
  farm:     { moisture: { delta: +0.08, radius: 5 } },
  temple:   {},
  port:     { moisture: { delta: +0.20, radius: 8 } },
  plains:   { moisture: { delta: -0.10, radius: 8 } },
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
  const { width, height } = config;

  for (const poi of pois) {
    if (!poi.position) continue;
    const spec = POI_INFLUENCES[poi.type];
    if (!spec) continue;

    const px = poi.position.x;
    const py = poi.position.y;

    applyFieldInfluence(fields.elevation,   spec.elevation,   px, py, width, height);
    applyFieldInfluence(fields.moisture,    spec.moisture,    px, py, width, height);
    applyFieldInfluence(fields.temperature, spec.temperature, px, py, width, height);
  }
}

function applyFieldInfluence(
  field:   Float32Array,
  spec:    FieldInfluence | undefined,
  px:      number,
  py:      number,
  width:   number,
  height:  number,
): void {
  if (!spec) return;
  const { delta, radius } = spec;
  const r2 = radius * radius;

  const x0 = Math.max(0, Math.floor(px - radius));
  const x1 = Math.min(width  - 1, Math.ceil(px + radius));
  const y0 = Math.max(0, Math.floor(py - radius));
  const y1 = Math.min(height - 1, Math.ceil(py + radius));

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - px, dy = y - py;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      // Cosine falloff: full influence at center, 0 at edge
      const t = Math.cos((Math.sqrt(d2) / radius) * (Math.PI / 2));
      const idx = y * width + x;
      field[idx] = Math.max(0, Math.min(1, field[idx] + delta * t));
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

  let maxR = 0;
  for (const inf of Object.values(spec) as (FieldInfluence | undefined)[]) {
    if (inf && inf.radius > maxR) maxR = inf.radius;
  }
  if (maxR === 0) return null;

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
