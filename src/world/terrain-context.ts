// src/world/terrain-context.ts
//
// The OBJECT ↔ TERRAIN contextual-blend SEAM (Roads design doc 2026-06-24, §engine-wide).
//
// A carved road already reads its surroundings: it preserves the biome UNDER it (`baseType`) and
// the unified terrain material gradient dresses snow/ice/mud on top, so a cold road ices and a wet
// track muds with no road-specific shader branch. This module promotes that idea to a FIRST-CLASS,
// SHARED sampler so ANY object — a building base, a wall footing, a prop, a future bridge deck —
// can ask "what is the ground like HERE?" and blend into it the same way instead of being pasted
// on flat.
//
// `sampleTerrainContext(map, tx, ty)` returns the unified per-tile environmental signals
// (under-biome, moisture, temperature, elevation, snow + mud dressing weights), derived from the
// SAME memoised climate/height fields the terrain shader reads — so an object's contextual dressing
// stays consistent with the ground it sits on. Pure + deterministic.
//
// CONSUMERS: road evolution weathers surfaces through `weatherAggression` (rain + frost) today;
// `sampleTerrainContext`/`groundBlend` are the engine-wide API for the building/wall/prop rollout
// (snow on a cold roof, a muddy apron in wet ground, a base tinted toward its biome).

import type { GameMap } from '@/core/types';
import { getClimateFields, elevationAt } from '@/world/heightfield';
import { clamp01 } from '@/core/math';

/** Biome temperature (0..1) at/below which ground starts to hold snow (climate.ts snowline). */
export const SNOWLINE = 0.30;

/** White-dressing weight 0..1: snow accumulates as ground temperature drops below the snowline,
 *  full by ~0.18 below it. */
export function snowWeight(temperature: number): number {
  return clamp01((SNOWLINE - temperature) / 0.18);
}

/** Mud weight 0..1: wet ground that isn't frozen turns muddy — past half-moisture, scaled by how
 *  un-snowy it is (frozen ground reads as snow/ice, not mud). */
export function mudWeight(moisture: number, snow: number): number {
  return clamp01((moisture - 0.5) * 2) * (1 - snow);
}

/** The unified terrain conditions at a tile — what any object blends INTO. */
export interface TerrainContext {
  /** Biome tile type at this cell (under-object ground; `baseType` if a road overwrote `type`). */
  baseType: string | undefined;
  /** Ground wetness 0..1. */
  moisture: number;
  /** Ground temperature 0..1 (biome scale; 0 frozen … 0.8 desert-hot). */
  temperature: number;
  /** Normalised elevation 0..1. */
  elevation: number;
  /** Snow/ice dressing weight 0..1 (cold ground). */
  snow: number;
  /** Mud/wet-apron weight 0..1 (wet, unfrozen ground). */
  mud: number;
}

/** Build a context from already-sampled scalars (the pure core — no field lookup). Lets callers
 *  that hold their own moisture/temperature (e.g. an injected test field, or an edge midpoint
 *  sample) share the exact snow/mud derivation without re-reading the climate fields. */
export function terrainContextFrom(
  moisture: number, temperature: number, elevation = 0, baseType?: string,
): TerrainContext {
  const m = clamp01(moisture);
  const t = clamp01(temperature);
  const snow = snowWeight(t);
  return { baseType, moisture: m, temperature: t, elevation, snow, mud: mudWeight(m, snow) };
}

/**
 * Sample the unified terrain context at a tile (edge-clamped). Reads the SAME memoised climate +
 * height fields the terrain shader uses, so an object dressed from this matches its ground.
 * Deterministic. This is the engine-wide object↔terrain blend seam — the single place "what is the
 * ground like here" is answered.
 */
export function sampleTerrainContext(map: GameMap, tx: number, ty: number): TerrainContext {
  const { width, height } = map;
  const cx = Math.max(0, Math.min(width - 1, Math.round(tx)));
  const cy = Math.max(0, Math.min(height - 1, Math.round(ty)));
  const i = cy * width + cx;
  const fields = getClimateFields(map);
  const tile = map.tiles?.[cy]?.[cx];
  return terrainContextFrom(
    fields.moisture[i] ?? 0.5,
    fields.temperature[i] ?? 0.5,
    elevationAt(map, cx, cy),
    tile ? (tile.baseType ?? tile.type) : undefined,
  );
}

/** Object dressing weights derived from a context — what an object renderer applies to read as
 *  "sitting in" the terrain: white in snow, a muddy apron in wet ground, and a tint toward the
 *  under-biome. The generic consumer hook for the building/wall/prop rollout. */
export interface GroundBlend {
  snow: number;
  mud: number;
  /** How strongly to tint the object base toward its ground biome 0..1 (more on soft ground). */
  biomeTint: number;
}
export function groundBlend(ctx: TerrainContext): GroundBlend {
  return {
    snow: ctx.snow,
    mud: ctx.mud,
    biomeTint: clamp01(0.25 + 0.5 * ctx.mud + 0.4 * ctx.snow),
  };
}

/** Surface weathering aggression 0..1 (rain + frost) at a context — the road system's climate
 *  term, expressed HERE so roads and objects agree on "how harsh is the weather on a surface
 *  here". Wet ground rains a surface apart; snowy ground frost-heaves it. */
export function weatherAggression(ctx: TerrainContext): number {
  return clamp01(0.3 + 0.45 * ctx.moisture + 0.55 * ctx.snow);
}
