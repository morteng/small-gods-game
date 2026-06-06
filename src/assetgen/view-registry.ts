/**
 * Versioned recipe + native-size registry, keyed by AssetView.
 *
 * Generalizes the frozen pixflux STYLE_RECIPE (= recipe `v1`) and pins the
 * PIXEL-PERFECT native pixel size per view so generated art blits 1:1 onto its
 * target at base zoom (zoom = 1). `recipeVersion` feeds the PixelLab cache key,
 * so a brief → deterministic prompt → stable key → base-library dedupe holds.
 */
import { ISO_TILE_W, ISO_TILE_H } from '@/render/iso/iso-constants';
import type { AssetBrief, AssetView } from './asset-brief';

export interface ViewSize {
  width: number;
  height: number;
}

export interface ViewRecipe {
  /** Bumped when the recipe changes; part of the generation cache key. */
  recipeVersion: string;
  outline: string;
  shading: string;
  detail: string;
  /** Baked light direction — consistent across every generated asset. */
  lightDirection: 'top-left';
  /** Native pixel size at base zoom, derived purely from the brief. */
  nativeSize(brief: AssetBrief): ViewSize;
}

/** Clamp to [lo, hi] then snap to the nearest multiple of 16 (clean pixel grid). */
function clampSnap16(v: number, lo: number, hi: number): number {
  const clamped = Math.max(lo, Math.min(hi, v));
  return Math.round(clamped / 16) * 16;
}

/**
 * Iso silhouette bounding box at base zoom: footprint diamond + vertical rise.
 *   width  = (w + h) · ISO_TILE_W/2        — iso diamond width
 *   height = (w + h) · ISO_TILE_H/2 + rise·ISO_TILE_H
 * Both clamped to [64, 256] (gen-cost ceiling) and snapped to 16px.
 */
function isoNativeSize(brief: AssetBrief): ViewSize {
  const fp = brief.footprint ?? { w: 1, h: 1 };
  const rise = brief.heightUnits ?? 1;
  const width = clampSnap16((fp.w + fp.h) * (ISO_TILE_W / 2), 64, 256);
  const height = clampSnap16(
    (fp.w + fp.h) * (ISO_TILE_H / 2) + rise * ISO_TILE_H,
    64,
    256,
  );
  return { width, height };
}

export const VIEW_RECIPES: Record<AssetView, ViewRecipe> = {
  'iso-3q': {
    recipeVersion: 'v1',
    outline: 'single color black outline',
    shading: 'basic shading',
    detail: 'medium detail',
    lightDirection: 'top-left',
    nativeSize: isoNativeSize,
  },
  'front-portrait': {
    recipeVersion: 'v1',
    outline: 'single color black outline',
    shading: 'detailed shading',
    detail: 'highly detailed',
    lightDirection: 'top-left',
    nativeSize: () => ({ width: 128, height: 128 }),
  },
  topdown: {
    recipeVersion: 'v1',
    outline: 'single color black outline',
    shading: 'basic shading',
    detail: 'low detail',
    lightDirection: 'top-left',
    nativeSize: () => ({ width: 64, height: 64 }),
  },
  side: {
    recipeVersion: 'v1',
    outline: 'single color black outline',
    shading: 'basic shading',
    detail: 'medium detail',
    lightDirection: 'top-left',
    nativeSize: () => ({ width: 64, height: 64 }),
  },
};
