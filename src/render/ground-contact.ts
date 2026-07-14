// src/render/ground-contact.ts
//
// The TERRAIN → ENTITY contact blend: what colour the ground is at an entity's foot, so
// the lit shader can bleed it into the BOTTOM of the sprite and a rock reads as LODGED in
// the ground rather than set down on it.
//
// The bury crop (iso-sprites) sinks the sprite below the surface LINE, but the cut is a
// hard silhouette edge — soil and snow do not stop dead at a rock's outline, they bank
// against it. So near the foot we mix the sprite's albedo toward the local ground tone,
// and where the terrain paints SNOW (the same CPU snow mask the per-instance whiten
// reads) the ground tone IS snow — a drift piled against the base instead of a hard cut.
//
// Approximation, stated honestly: this is the tile's BASE biome colour (`TILE_COLORS`,
// the same table `packColorField` paints from), not the shader's final per-pixel ground
// (which further modulates by the biome ground-texture + climate swatches). At the 2–8 px
// contact band the base tone is the dominant term and the difference is invisible; going
// through the GPU's exact value would mean reading back the terrain target.
//
// Deterministic + memoised per (map, tilesRev) in a lazy per-tile cache — the draw-list
// rebuild calls this once per plant/rock instance (tens of thousands), so the hex parse
// must not run per call.

import type { GameMap } from '@/core/types';
import { TILE_COLORS } from '@/core/constants';
import { snowAmount01 } from '@/render/snow-mask';

/** The terrain snow tone. MUST match the constant the lit shader mixes toward
 *  (`lit-wgsl.ts` fsMain, `vec3<f32>(0.94, 0.95, 0.97)`), itself the mean tone of the
 *  terrain snow exemplar — otherwise a rock's snow drift and the ground's snow are two
 *  different whites meeting at the contact line. */
export const SNOW_TONE: readonly [number, number, number] = [0.94, 0.95, 0.97];

/** Fallback ground tone for a tile type with no authored colour (matches packColorField). */
const FALLBACK = '#444444';

function parseHex(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return [0.27, 0.27, 0.27];
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
}

interface ContactCache {
  /** 3 floats per tile; NaN in the r slot = not computed yet. */
  rgb: Float32Array;
  tilesRev: number | undefined;
}
const cacheByMap = new WeakMap<GameMap, ContactCache>();

function cacheFor(map: GameMap): ContactCache {
  let c = cacheByMap.get(map);
  if (!c || c.tilesRev !== map.tilesRev) {
    c = { rgb: new Float32Array(map.width * map.height * 3).fill(NaN), tilesRev: map.tilesRev };
    cacheByMap.set(map, c);
  }
  return c;
}

/**
 * The ground's colour at a tile as the contact blend should read it: the tile's base
 * biome tone, mixed toward the snow tone by the terrain's own snow amount there. Values
 * in [0,1]. Reading `baseType ?? type` (like `packColorField`) means a rock beside a road
 * blends toward the ground UNDER the road, not road-brown.
 */
export function groundContactColor(map: GameMap, tx: number, ty: number): [number, number, number] {
  const W = map.width, H = map.height;
  const x = Math.min(W - 1, Math.max(0, Math.trunc(tx)));
  const y = Math.min(H - 1, Math.max(0, Math.trunc(ty)));
  const c = cacheFor(map);
  const i = (y * W + x) * 3;
  if (Number.isNaN(c.rgb[i])) {
    const tile = map.tiles?.[y]?.[x];
    const type = tile ? (tile.baseType ?? tile.type) : undefined;
    const base = parseHex((type ? TILE_COLORS[type] : undefined) ?? FALLBACK);
    const snow = snowAmount01(map, x, y);
    c.rgb[i] = base[0] + (SNOW_TONE[0] - base[0]) * snow;
    c.rgb[i + 1] = base[1] + (SNOW_TONE[1] - base[1]) * snow;
    c.rgb[i + 2] = base[2] + (SNOW_TONE[2] - base[2]) * snow;
  }
  return [c.rgb[i], c.rgb[i + 1], c.rgb[i + 2]];
}

/** How hard a class of nature entity is blended into the ground at its foot, and over
 *  what fraction of its drawn height. A rock is LODGED (strong, short band); ground cover
 *  grows OUT of the soil (softer, but the blend climbs higher through the blades). */
export const CONTACT_BASE = { rock: 0.70, cover: 0.45 } as const;
const CONTACT_BAND = { rock: 0.20, cover: 0.32 } as const;

/**
 * Contact strength + band for an instance, given how snowy its tile is. Snow DRIFTS: it
 * banks harder against the base and climbs higher up it than bare soil does, so both
 * terms rise with the snow mask (and the colour it blends toward is already snow — see
 * `groundContactColor`). Strength stays < 1: the rock's own form must survive the blend.
 */
export function contactBlendFor(cls: 'rock' | 'cover', snow: number): { strength: number; band: number } {
  const s = Math.min(1, Math.max(0, snow));
  const base = CONTACT_BASE[cls];
  return {
    strength: Math.min(0.95, base + (1 - base) * 0.45 * s),
    band: Math.min(0.5, CONTACT_BAND[cls] * (1 + 0.6 * s)),
  };
}
