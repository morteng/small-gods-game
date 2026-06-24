// src/render/gpu/detail-field.ts
//
// The CPU bake for the adaptive detail-patch pass: turn a world's importance map
// (`computeDetailMask`) into the GPU buffers the patch shader instances. For each
// flagged PATCH_TILES×PATCH_TILES block we bake a FINE×FINE lattice of GENUINE
// sub-tile render heights (`makeDetailElevSampler`), packed contiguously, plus a
// per-patch tile origin. Memoised per map — the bake is a one-time cost, not
// per-frame. Pure data; no GPU/DOM.

import type { GameMap, ConnectomeWaterOverride } from '@/core/types';
import { computeDetailMask, coalescePatches, makeDetailElevSampler } from '@/world/terrain-detail';
import { DP_PATCH_TILES, DP_SUPER } from '@/render/gpu/wgsl/detail-patch-wgsl';

/** Tiles per patch edge (matches the shader's PATCH_TILES). */
export const DETAIL_PATCH_TILES = DP_PATCH_TILES;
/** Supersample factor per patch edge (matches the shader's SUPER). */
export const DETAIL_SUPERSAMPLE = DP_SUPER;

const FINE = DETAIL_PATCH_TILES * DETAIL_SUPERSAMPLE + 1; // verts per patch edge
const FINE_PER_PATCH = FINE * FINE;
const VERTS_PER_PATCH = DETAIL_PATCH_TILES * DETAIL_SUPERSAMPLE * DETAIL_PATCH_TILES * DETAIL_SUPERSAMPLE * 6;

export interface DetailField {
  /** Per-patch tile origin (ox,oy) — the instance vertex buffer (2 floats/patch). */
  origins: Float32Array;
  /** Packed fine render-elevation lattices: `patchCount * FINE*FINE`, row-major
   *  per patch (the patch-shader storage buffer). */
  heights: Float32Array;
  patchCount: number;
  /** Vertices to draw per instance (`(PATCH_TILES*SUPER)^2 * 6`). */
  vertexCountPerPatch: number;
}

// Memoise the last world's bake — the importance map + lattice are derived purely
// from (seed, dims, edit version), so a static world reuses the same buffers (the
// scene's upload reference-guards on these array identities and skips re-uploading).
let memo: { map: GameMap; version: number; field: DetailField | null } | null = null;

/**
 * Build (or reuse) the detail-patch field for a world: bake a fine height lattice
 * for every hot patch block. Returns null when nothing is flagged (no detail to
 * draw). Deterministic; memoised by map identity + connectome edit version.
 *
 * `connectomeWater` (studio editing) supplies the EDITED render classification so an
 * author-placed lake gets the fine mesh on its banks too; absent → the base world's
 * render classification (the game path), byte-identical to before.
 */
export function buildDetailField(map: GameMap, connectomeWater?: ConnectomeWaterOverride): DetailField | null {
  const version = connectomeWater?.version ?? 0;
  if (memo && memo.map === map && memo.version === version) return memo.field;

  const mask = computeDetailMask(map, { waterType: connectomeWater?.waterType });
  const patches = coalescePatches(mask, map.width, map.height, DETAIL_PATCH_TILES);
  if (patches.length === 0) { memo = { map, version, field: null }; return null; }

  const sampler = makeDetailElevSampler(map);
  const S = DETAIL_SUPERSAMPLE;
  const heights = new Float32Array(patches.length * FINE_PER_PATCH);
  const origins = new Float32Array(patches.length * 2);

  for (let p = 0; p < patches.length; p++) {
    const { ox, oy } = patches[p];
    origins[p * 2] = ox;
    origins[p * 2 + 1] = oy;
    const base = p * FINE_PER_PATCH;
    for (let j = 0; j < FINE; j++) {
      const ty = oy + j / S;
      for (let i = 0; i < FINE; i++) {
        heights[base + j * FINE + i] = sampler(ox + i / S, ty);
      }
    }
  }

  const field: DetailField = {
    origins, heights, patchCount: patches.length, vertexCountPerPatch: VERTS_PER_PATCH,
  };
  memo = { map, version, field };
  return field;
}

/** Drop the memoised detail field (tests; harmless in prod). */
export function clearDetailFieldCache(): void { memo = null; }
