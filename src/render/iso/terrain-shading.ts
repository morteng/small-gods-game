// src/render/iso/terrain-shading.ts
//
// Pure terrain tile shading — the ONE source of truth for how a ground tile's
// colour is computed from its base biome colour + world elevation + per-tile
// noise. Both the Canvas2D diamond renderer (`iso-terrain.ts`) and the GPU
// heightfield mesh (`gpu/terrain-mesh.ts`, R2d) call this, so the two backends
// shade identically by construction (no drift at the WebGPU cutover).
//
// Elevation (R1): ground above the waterline lightens, below darkens, so relief
// reads at a glance. Noise: a deterministic ±NOISE_AMP lightness jitter hashed
// from (tx,ty) breaks the flat-poster look — `Math.random`-free, stable across
// frames/scrub.

import { ELEVATION_SEA_LEVEL } from '@/world/heightfield';

/** Per-tile lightness jitter amplitude (fraction of the base colour). */
export const NOISE_AMP = 0.06;
/**
 * Height-shading gain: brightness multiplier per unit of normalised elevation
 * away from the waterline. At elevation 1 (≈0.65 above sea) a peak reads ~1.5×;
 * at elevation 0 a trench reads ~0.7×. Clamped to keep colours in gamut.
 */
export const HEIGHT_SHADE_GAIN = 0.8;
export const HEIGHT_SHADE_MIN = 0.5;
export const HEIGHT_SHADE_MAX = 1.6;

/**
 * Deterministic [0,1) hash of an integer tile coord. Mixes both axes through
 * `Math.imul` so neighbouring tiles decorrelate (the shared-LCG-step correlation
 * the tree scatter hit). No `Math.random` — stable per tile across frames.
 */
export function tileHash01(tx: number, ty: number): number {
  let h = Math.imul(tx | 0, 0x27d4eb2d) ^ Math.imul(ty | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h ^ (h >>> 13), 0x297a2d39);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Height brightness factor for a normalised elevation (clamped to gamut). */
export function heightShadeFactor(elev: number): number {
  return Math.max(HEIGHT_SHADE_MIN, Math.min(HEIGHT_SHADE_MAX,
    1 + (elev - ELEVATION_SEA_LEVEL) * HEIGHT_SHADE_GAIN));
}

/** Per-tile noise brightness factor (1 ± NOISE_AMP). */
export function tileNoiseFactor(tx: number, ty: number): number {
  return 1 + (tileHash01(tx, ty) - 0.5) * 2 * NOISE_AMP;
}

/** Combined tile brightness = height × noise. */
export function tileLightFactor(elev: number, tx: number, ty: number): number {
  return heightShadeFactor(elev) * tileNoiseFactor(tx, ty);
}

/** Scale a #rrggbb colour by `f` (clamped to 0..255 per channel). */
export function shadeHex(hex: string, f: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = Math.min(255, Math.round(((n >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((n >> 8) & 255) * f));
  const b = Math.min(255, Math.round((n & 255) * f));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

/** Parse a #rrggbb colour to linear-ish [r,g,b] in 0..1 (no gamma — matches the
 *  Canvas2D path, which composites in sRGB bytes). */
export function hexToRgb01(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return [0.27, 0.27, 0.27]; // '#444'-ish fallback
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** The lit tile colour as a #rrggbb hex (Canvas2D path). */
export function litTileColorHex(baseHex: string, elev: number, tx: number, ty: number): string {
  return shadeHex(baseHex, tileLightFactor(elev, tx, ty));
}

/** The lit tile colour as [r,g,b] 0..1 (GPU vertex-colour path). Clamped so a
 *  bright peak stays in gamut exactly like {@link shadeHex}. */
export function litTileColorRGB(baseHex: string, elev: number, tx: number, ty: number): [number, number, number] {
  const f = tileLightFactor(elev, tx, ty);
  const [r, g, b] = hexToRgb01(baseHex);
  return [Math.min(1, r * f), Math.min(1, g * f), Math.min(1, b * f)];
}
