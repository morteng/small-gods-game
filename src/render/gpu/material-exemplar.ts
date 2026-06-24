// src/render/gpu/material-exemplar.ts
//
// Tileable MATERIAL-EXEMPLAR layer — seamless procedural surface swatches for terrain
// AND road materials (it superseded + replaced the old road-material atlas). Each is small,
// SEAMLESS (toroidal) swatch carrying albedo + a local-frame normal, built procedurally
// with the shared seamless primitives in `material-noise.ts`. No `Math.random`.
//
// WHY this exists (epic `2026-06-24-procedural-material-textures-img2img`):
//   1. the live terrain/road shader samples these tiles (Slice 1/2) for real surface
//      texture instead of flat per-cell colour, and
//   2. the SAME procedural tile is the "grey-init" handed to the img2img pipeline later
//      (Slice 3/4) — the exact analogue of a building's grey massing render. An
//      img2img-upgraded swatch drops into the identical texture slot (freeze-safe).
//
// Palette anchors track the analytic material albedos in `terrain-wgsl.ts`
// (ROCK/SNOW/SAND/MUD/EARTH/COBBLE) so sampling these composites cleanly over — and
// degrades gracefully back to — the existing procedural look.

import { periodicFbm, periodicNoise, worley, encodeNormal, packRgb, wrap } from './material-noise';

/** Terrain materials + road surfaces. Order is the texture-array layer order. */
export type MaterialId =
  | 'grass' | 'dirt' | 'rock' | 'sand' | 'snow' | 'mud'
  | 'road_dirt' | 'road_gravel' | 'road_cobble';

export const MATERIAL_IDS: readonly MaterialId[] = [
  'grass', 'dirt', 'rock', 'sand', 'snow', 'mud',
  'road_dirt', 'road_gravel', 'road_cobble',
] as const;

/** Layer index of each material in a stacked atlas (`buildMaterialAtlas`). */
export const MATERIAL_LAYER: Record<MaterialId, number> =
  Object.fromEntries(MATERIAL_IDS.map((id, i) => [id, i])) as Record<MaterialId, number>;

/** Recipe version — bump on ANY generator change (gates img2img cache + golden hashes). */
export const TEXTURE_RECIPE_VERSION = 'tex-v1';

export interface MaterialExemplar {
  id: MaterialId;
  /** Edge length in texels (square). */
  size: number;
  /** RGBA8 albedo, size*size*4, opaque. */
  albedo: Uint8Array;
  /** RGBA8 local-frame normal (RG in-plane bump, B up). */
  normal: Uint8Array;
}

interface LayerBuild { height: Float32Array; albedo: Uint8Array; }

// ── Generators ──────────────────────────────────────────────────────────────────────
// Each returns a 0..1 height (for the normal) + an opaque RGBA8 albedo. Every noise call
// is periodic (period divides `size`) so the swatch wraps with no seam.

function buildGrass(size: number): LayerBuild {
  const height = new Float32Array(size * size);
  const albedo = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x;
    const macro = periodicFbm(x * (6 / size), y * (6 / size), 6, 3);     // patches
    const blade = periodicNoise(x * (48 / size), y * (48 / size), 48);   // fine blades
    height[i] = 0.25 * blade + 0.15 * macro;
    // Mottled green: drier (yellow-green) in macro lows, lush in highs.
    const r = 0.30 + 0.18 * macro + 0.04 * blade;
    const g = 0.58 + 0.18 * macro + 0.05 * blade;
    const b = 0.30 + 0.10 * macro;
    packRgb(albedo, i, r, g, b);
  }
  return { height, albedo };
}

function buildDirt(size: number): LayerBuild {
  const height = new Float32Array(size * size);
  const albedo = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x;
    const n = periodicFbm(x * (8 / size), y * (8 / size), 8, 3);
    height[i] = n * 0.35;
    const r = 0.42 + 0.16 * n, g = 0.33 + 0.13 * n, b = 0.23 + 0.09 * n;
    packRgb(albedo, i, r, g, b);
  }
  return { height, albedo };
}

function buildRock(size: number): LayerBuild {
  const height = new Float32Array(size * size);
  const albedo = new Uint8Array(size * size * 4);
  const cells = 5;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x;
    const { dist, hash } = worley(x, y, size, cells, 0.8);
    const cellR = size / cells;
    const crack = 1 - Math.min(1, dist / (cellR * 0.62));   // 1 at cell centre → 0 at the seam
    const grain = periodicFbm(x * (16 / size), y * (16 / size), 16, 3);
    height[i] = 0.35 + 0.45 * crack + 0.2 * grain;          // blocky, raised facets, grooved seams
    const tone = 0.40 + 0.10 * hash + 0.10 * grain;
    const shade = crack < 0.12 ? 0.55 : 1.0;                // darken the crevices
    packRgb(albedo, i, tone * 1.05 * shade, tone * shade, tone * 0.93 * shade);
  }
  return { height, albedo };
}

function buildSand(size: number): LayerBuild {
  const height = new Float32Array(size * size);
  const albedo = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x;
    // Ripples = integer-cycle sines (seamless), warped by low-freq noise; fine grain on top.
    const warp = periodicNoise(x * (4 / size), y * (4 / size), 4);
    const ripple = 0.5 + 0.5 * Math.sin((y * (10 / size) + warp * 1.5) * 2 * Math.PI);
    const grain = periodicNoise(x * (40 / size), y * (40 / size), 40);
    height[i] = 0.5 * ripple + 0.12 * grain;
    const v = 0.78 + 0.10 * ripple + 0.05 * grain;
    packRgb(albedo, i, v, v * 0.92, v * 0.69);
  }
  return { height, albedo };
}

function buildSnow(size: number): LayerBuild {
  const height = new Float32Array(size * size);
  const albedo = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x;
    const drift = periodicFbm(x * (5 / size), y * (5 / size), 5, 3);
    const sparkle = periodicNoise(x * (56 / size), y * (56 / size), 56);
    height[i] = 0.2 * drift + 0.06 * sparkle;
    const v = 0.90 + 0.07 * drift + 0.03 * sparkle;
    packRgb(albedo, i, v * 0.99, v, Math.min(1, v * 1.02));   // faint blue cast
  }
  return { height, albedo };
}

function buildMud(size: number): LayerBuild {
  const height = new Float32Array(size * size);
  const albedo = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x;
    const n = periodicFbm(x * (7 / size), y * (7 / size), 7, 3);
    const puddle = Math.max(0, 0.42 - n) / 0.42;             // low spots hold water
    height[i] = n * 0.3 - puddle * 0.18;                     // puddles sink
    const wet = 1 - 0.4 * puddle;                            // darker, glossier in puddles
    const r = (0.32 + 0.12 * n) * wet, g = (0.25 + 0.10 * n) * wet, b = (0.17 + 0.07 * n) * wet;
    packRgb(albedo, i, r, g, b);
  }
  return { height, albedo };
}

function buildRoadDirt(size: number): LayerBuild {
  const height = new Float32Array(size * size);
  const albedo = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x;
    const n = periodicFbm(x * (10 / size), y * (10 / size), 10, 2);
    height[i] = n * 0.2;                                     // packed, low relief
    const r = 0.36 + 0.10 * n, g = 0.29 + 0.08 * n, b = 0.21 + 0.06 * n;
    packRgb(albedo, i, r, g, b);
  }
  return { height, albedo };
}

function buildRoadGravel(size: number): LayerBuild {
  const height = new Float32Array(size * size);
  const albedo = new Uint8Array(size * size * 4);
  const chips = 11;                                          // many small stones
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x;
    const { dist, hash } = worley(x, y, size, chips, 0.9);
    const chipR = (size / chips) * 0.5;
    const t = Math.min(1, dist / chipR);
    const dome = Math.sqrt(Math.max(0, 1 - t * t));          // rounded chip
    const grit = periodicNoise(x * (40 / size), y * (40 / size), 40);
    height[i] = 0.15 + 0.7 * dome + 0.1 * grit;
    const tone = 0.42 + 0.16 * hash;
    const v = tone * (0.7 + 0.3 * dome);
    packRgb(albedo, i, v, v * 0.95, v * 0.86);
  }
  return { height, albedo };
}

function buildRoadCobble(size: number): LayerBuild {
  const height = new Float32Array(size * size);
  const albedo = new Uint8Array(size * size * 4);
  const cells = 4;
  const R = (size / cells) * 0.46;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x;
    const { dist, hash } = worley(x, y, size, cells, 0.5);
    const t = Math.min(1, dist / R);
    const dome = dist <= R ? Math.sqrt(1 - t * t) : 0;
    const mortar = dist > R;
    height[i] = dome;
    const tone = 0.50 + 0.13 * hash;
    const lit = mortar ? 0.22 : tone * (0.85 + 0.15 * dome);
    packRgb(albedo, i, lit, lit * 0.98, lit * 0.94);
  }
  return { height, albedo };
}

const GENERATORS: Record<MaterialId, { build: (size: number) => LayerBuild; bump: number }> = {
  grass:        { build: buildGrass,      bump: 0.15 },
  dirt:         { build: buildDirt,       bump: 0.18 },
  rock:         { build: buildRock,       bump: 0.70 },
  sand:         { build: buildSand,       bump: 0.22 },
  snow:         { build: buildSnow,       bump: 0.08 },
  mud:          { build: buildMud,        bump: 0.16 },
  road_dirt:    { build: buildRoadDirt,   bump: 0.16 },
  road_gravel:  { build: buildRoadGravel, bump: 0.45 },
  road_cobble:  { build: buildRoadCobble, bump: 0.60 },
};

/** Build one seamless material exemplar (albedo + local-frame normal). Pure, deterministic. */
export function buildMaterialExemplar(id: MaterialId, size = 64): MaterialExemplar {
  const gen = GENERATORS[id];
  const { height, albedo } = gen.build(size);
  const normal = new Uint8Array(size * size * 4);
  encodeNormal(height, size, gen.bump, normal, 0);
  return { id, size, albedo, normal };
}

/** A stacked texture-array atlas of ALL materials (layer index = `MATERIAL_LAYER[id]`). */
export interface MaterialAtlas {
  size: number;
  layers: number;
  /** RGBA8 albedo, layers stacked (size*size*4 per layer, in `MATERIAL_IDS` order). */
  albedo: Uint8Array;
  /** RGBA8 local-frame normal, layers stacked. */
  normal: Uint8Array;
}

export function buildMaterialAtlas(size = 64): MaterialAtlas {
  const per = size * size * 4;
  const albedo = new Uint8Array(per * MATERIAL_IDS.length);
  const normal = new Uint8Array(per * MATERIAL_IDS.length);
  for (let l = 0; l < MATERIAL_IDS.length; l++) {
    const ex = buildMaterialExemplar(MATERIAL_IDS[l], size);
    albedo.set(ex.albedo, l * per);
    normal.set(ex.normal, l * per);
  }
  return { size, layers: MATERIAL_IDS.length, albedo, normal };
}

// Memoised — content-static, built once per session.
let atlasMemo: MaterialAtlas | null = null;
export function materialAtlas(size = 64): MaterialAtlas {
  if (!atlasMemo || atlasMemo.size !== size) atlasMemo = buildMaterialAtlas(size);
  return atlasMemo;
}

/** Reset the memo (tests / a recipe hot-reload). */
export function clearMaterialAtlasCache(): void { atlasMemo = null; }

// Re-export the wrap helper so consumers measuring seam continuity share one impl.
export { wrap };
