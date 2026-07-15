// Slice-2 ground texture — per-biome COLOUR surface texture on open ground.
//
// The terrain fragment now samples the material-exemplar atlas as full COLOUR for
// open ground (grass/dirt/sand picked by the climate fields), mean-normalised per
// swatch so the per-cell biome colour field stays the hue authority, band-limited
// by the pixel footprint (decays to the flat biome colour at overview), with
// `?groundtex=off` as the A/B escape back to the pre-Slice-2 grayscale grain.
// These tests pin the WGSL contract + the CPU plumbing of the toggle.

import { describe, it, expect } from 'vitest';
import { TERRAIN_WGSL } from '@/render/gpu/wgsl/terrain-wgsl';
import {
  packTerrainPassGlobals, TERRAIN_PASS_GLOBALS_FLOATS, type TerrainGlobalsInput,
} from '@/render/gpu/instance-buffer';
import { buildTerrainField } from '@/render/gpu/terrain-field';
import { groundTexDisabled } from '@/render/gpu/gpu-render-frame';
import { DEFAULT_LIGHTING } from '@/render/lighting-state';
import type { GameMap, Tile } from '@/core/types';

function tinyMap(w: number, h: number): GameMap {
  const tiles: Tile[][] = [];
  for (let y = 0; y < h; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < w; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
    tiles.push(row);
  }
  return {
    tiles, width: w, height: h, villages: [], seed: 1234, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [],
  };
}

describe('terrain WGSL — Slice-2 colour ground texture', () => {
  it('declares the uFlags vec4 in TGlobals (ground-texture enable rides uFlags.x)', () => {
    expect(TERRAIN_WGSL).toContain('uFlags    : vec4<f32>');
    expect(TERRAIN_WGSL).toContain('G.uFlags.x');
  });

  it('samples the atlas as mean-normalised COLOUR detail (matDetail, explicit LOD only)', () => {
    // The helper exists and uses explicit-LOD sampling (legal in the non-uniform
    // texFade branch — no derivative builtin inside it).
    expect(TERRAIN_WGSL).toMatch(/fn matDetail\(layer : i32, uv : vec2<f32>, lod : f32\)/);
    expect(TERRAIN_WGSL).toContain('textureSampleLevel(matAtlas, matSamp, uv, layer,');
    // Mean = the 1×1 top mip — the hue-authority normaliser.
    expect(TERRAIN_WGSL).toContain('textureNumLevels(matAtlas)');
  });

  it('splats grass/dry/dust/pebble ground patches terrain-aware on open ground', () => {
    // Four real harvested swatches in a texture ARRAY, blended by wetness + a bare-patch field.
    expect(TERRAIN_WGSL).toContain('groundTex  : texture_2d_array<f32>');
    expect(TERRAIN_WGSL).toMatch(/textureSampleLevel\(groundTex, groundSamp, uv0, layer/);
    expect(TERRAIN_WGSL).toContain('wGrass');
    expect(TERRAIN_WGSL).toContain('wDry');
    expect(TERRAIN_WGSL).toContain('wDust');
    // Only the LUSH grass is mean-normalised (biome stays the hue authority); dust/dry/pebble
    // keep their own real colour so drying ground genuinely turns earthy, not a green wash.
    expect(TERRAIN_WGSL).toContain('GROUND_GRASS_MEAN');
    expect(TERRAIN_WGSL).toMatch(/groundPatch\(GROUND_LAYER_GRASS/);
    expect(TERRAIN_WGSL).toMatch(/groundPatch\(GROUND_LAYER_DUST/);
    expect(TERRAIN_WGSL).toMatch(/groundPatch\(GROUND_LAYER_PEBBLE/);
    expect(TERRAIN_WGSL).toMatch(/groundPatch\(GROUND_LAYER_DRY/);
  });

  it('band-limits with a footprint fade and skips the block entirely past it', () => {
    expect(TERRAIN_WGSL).toContain('let texFade = smoothstep(');
    expect(TERRAIN_WGSL).toContain('if (texFade > 0.0)');
  });

  it('keeps ONE grain path — the old grayscale grain lives only in the off branch', () => {
    // `?groundtex=off` fallback is present…
    expect(TERRAIN_WGSL).toContain("dot(matSample(0, muv), vec3<f32>(0.3333)) / 0.5");
    // …and exactly once (the new colour path must not double-apply grain on top).
    expect(TERRAIN_WGSL.match(/groundDetail/g)!.length).toBeLessThanOrEqual(2); // declare + use
  });

  it('applies texture BEFORE lighting (base feeds the height-blend composite → banded light)', () => {
    const groundIdx = TERRAIN_WGSL.indexOf('let base = mix(ground, roadAlb, roadMix)');
    const lightIdx = TERRAIN_WGSL.indexOf('let banded = floor(ndl * bands + 0.5) / bands');
    expect(groundIdx).toBeGreaterThan(-1);
    expect(lightIdx).toBeGreaterThan(groundIdx);
  });
});

describe('packTerrainPassGlobals — uFlags plumbing', () => {
  const tg: TerrainGlobalsInput = {
    viewport: [800, 600], xform: { sx: 1, sy: 1, ox: 0, oy: 0 },
    grid: [8, 8], half: [64, 32],
    zPxPerM: 20, seaLevel: 0.35, reliefM: 48, subsample: 1,
    sunDir: [-1, 1.6, -1], bands: 4, ambient: [0.4, 0.4, 0.45], sunStrength: 0.8,
  };

  it('is 32 floats (24 shared + uWindow + uFlags) with groundTex defaulting ON', () => {
    const b = packTerrainPassGlobals(tg);
    expect(TERRAIN_PASS_GLOBALS_FLOATS).toBe(32);
    expect(b).toHaveLength(32);
    expect(Array.from(b.subarray(24, 28))).toEqual([0, 0, 8, 8]); // uWindow unchanged
    expect(b[28]).toBe(1);                                        // uFlags.x default on
    expect(Array.from(b.subarray(29, 32))).toEqual([0, 0, 0]);    // reserved
  });

  it('writes uFlags.x = 0 when groundTex is disabled', () => {
    const b = packTerrainPassGlobals({ ...tg, groundTex: 0 });
    expect(b[28]).toBe(0);
  });
});

describe('buildTerrainField — groundTex option → globals', () => {
  const opts = {
    viewport: [800, 600] as [number, number],
    xform: { sx: 1, sy: 1, ox: 0, oy: 0 },
    lighting: DEFAULT_LIGHTING,
  };

  it('defaults the ground texture ON', () => {
    const g = buildTerrainField(tinyMap(8, 8), opts).globals;
    expect(g.groundTex).toBe(1);
    expect(packTerrainPassGlobals(g)[28]).toBe(1);
  });

  it('groundTex: false turns it off (the `?groundtex=off` path)', () => {
    const g = buildTerrainField(tinyMap(8, 8), { ...opts, groundTex: false }).globals;
    expect(g.groundTex).toBe(0);
    expect(packTerrainPassGlobals(g)[28]).toBe(0);
  });
});

describe('groundTexDisabled — URL escape hatch', () => {
  it('is off only for ?groundtex=off', () => {
    window.history.replaceState({}, '', '/');
    expect(groundTexDisabled()).toBe(false);
    window.history.replaceState({}, '', '/?groundtex=off');
    expect(groundTexDisabled()).toBe(true);
    window.history.replaceState({}, '', '/?groundtex=on');
    expect(groundTexDisabled()).toBe(false);
    window.history.replaceState({}, '', '/');
  });
});
