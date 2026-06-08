/**
 * Versioned recipe + native-size registry, keyed by AssetView.
 *
 * Generalizes the frozen pixflux STYLE_RECIPE (= recipe `v1`) and pins the
 * PIXEL-PERFECT native pixel size per view so generated art blits 1:1 onto its
 * target at base zoom (zoom = 1). `recipeVersion` feeds the PixelLab cache key,
 * so a brief → deterministic prompt → stable key → base-library dedupe holds.
 */
import { ISO_TILE_W, ISO_TILE_H } from '@/render/iso/iso-constants';
import { SUN_DIRECTION } from '@/render/lighting';
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
 * PixelLab caps generation at 400px per axis. `no_background` only cuts cleanly
 * ≤128px, but the building pipeline generates OPAQUE then runs a separate
 * remove-background pass — so the real ceiling here is the 400px gen limit, not
 * the 128px cutout limit. Building footprints are capped (≤3×3, see the
 * blueprint presets) so the true-size silhouette stays within this box.
 */
const ISO_MAX_GEN_PX = 400;
const ISO_MIN_PX = 64;

/**
 * Iso silhouette bounding box at base zoom — the TRUE on-grid pixel size so the
 * renderer can blit it 1:1 (native size == footprint diamond, no rescale):
 *   width  = (w + h) · ISO_TILE_W/2                  — iso diamond width
 *   height = (w + h) · ISO_TILE_H/2 + rise·ISO_TILE_H
 * Each axis is floored at ISO_MIN_PX and capped at ISO_MAX_GEN_PX (a safety net;
 * the footprint cap keeps every preset under it), snapped to 16px. No
 * aspect-preserving downscale — that would shrink the sprite below its footprint
 * and break the 1:1 contract.
 */
function isoNativeSize(brief: AssetBrief): ViewSize {
  const fp = brief.footprint ?? { w: 1, h: 1 };
  const rise = brief.heightUnits ?? 1;
  const rawW = (fp.w + fp.h) * (ISO_TILE_W / 2);
  const rawH = (fp.w + fp.h) * (ISO_TILE_H / 2) + rise * ISO_TILE_H;
  return {
    width: clampSnap16(rawW, ISO_MIN_PX, ISO_MAX_GEN_PX),
    height: clampSnap16(rawH, ISO_MIN_PX, ISO_MAX_GEN_PX),
  };
}

export const VIEW_RECIPES: Record<AssetView, ViewRecipe> = {
  'iso-3q': {
    // v2: baseless sprite (engine owns the ground tile) + view-relative door
    // phrasing + textGuidanceScale 13. Bumped so the next regen gets fresh cache
    // keys and won't collide with the v1 (baked-base, cardinal-door) art.
    recipeVersion: 'v2',
    outline: 'single color black outline',
    shading: 'basic shading',
    detail: 'medium detail',
    lightDirection: SUN_DIRECTION,
    nativeSize: isoNativeSize,
  },
  'front-portrait': {
    recipeVersion: 'v1',
    outline: 'single color black outline',
    shading: 'detailed shading',
    detail: 'highly detailed',
    lightDirection: SUN_DIRECTION,
    nativeSize: () => ({ width: 128, height: 128 }),
  },
  topdown: {
    recipeVersion: 'v1',
    outline: 'single color black outline',
    shading: 'basic shading',
    detail: 'low detail',
    lightDirection: SUN_DIRECTION,
    nativeSize: () => ({ width: 64, height: 64 }),
  },
  side: {
    recipeVersion: 'v1',
    outline: 'single color black outline',
    shading: 'basic shading',
    detail: 'medium detail',
    lightDirection: SUN_DIRECTION,
    nativeSize: () => ({ width: 64, height: 64 }),
  },
};
