// src/render/gpu/static-draw-list-cache.ts
//
// The static (camera-independent) half of the scene draw list, cached.
//
// The y-sorted draw list splits into two layers: a STATIC layer (flora, buildings,
// decorations, roads, barriers) that changes only when the WORLD does, and a
// dynamic layer (NPCs, flotsam) re-emitted every frame. The static build is the
// expensive one — the profiler clocked ~293 ms/frame over ~10k flora — so it is
// built UNCULLED once and reused across pan/zoom until its invalidation key
// changes. This class owns that cache; the render frame owns the per-frame dynamic
// layer.
//
// Invalidation is COARSE today (map identity + layer-visibility + building render
// mode). Static-entity edits (author add/move, settlement growth) don't yet move
// the key — `invalidate()` is the seam the regional dirty-region substrate (docs)
// will drive once incremental effects (digs/craters) land, and the manual escape
// hatch behind it.
//
// The draw builder is injectable so the cache logic (rebuild-on-key-change,
// reuse-on-match, invalidate) is unit-testable without a GPU or a real world.

import type { RenderContext, GameMap } from '@/core/types';
import type { DrawItem } from '@/render/iso/draw-list';
import type { IsoItemCtx } from '@/render/iso/iso-sprites';
import { buildEntityDrawList } from '@/render/iso/entity-draw-list';
import { isLayerHidden } from '@/render/layer-visibility';

/** Builds the full-map static draw list for a world. Injectable for tests. */
export type StaticDrawListBuilder = (rc: RenderContext, ic: IsoItemCtx) => DrawItem[];

const defaultBuilder: StaticDrawListBuilder = (rc, ic) => {
  const map = rc.map!;
  const full = { minTx: 0, minTy: 0, maxTx: map.width - 1, maxTy: map.height - 1 };
  return buildEntityDrawList(rc, full, ic, { only: 'static' });
};

/**
 * Coarse invalidation key for the cached STATIC draw layer. Camera AND NPCs are
 * deliberately EXCLUDED — the static list is unculled (camera-independent) and
 * NPCs render in a separate per-frame layer, so neither should bust the cache.
 * Keyed on map identity + layer-visibility flags + building render mode.
 */
export function drawCacheKey(rc: RenderContext, map: GameMap): string {
  const dm = rc.devMode;
  const layers = `${+isLayerHidden('buildings', dm)}${+isLayerHidden('vegetation', dm)}`
    + `${+isLayerHidden('terrain', dm)}`;
  const mode = dm?.buildingRenderMode ?? 'auto';
  // `buildingArtRev` bumps as async parametric massing packs settle, so the static
  // list rebuilds once they land (otherwise the first snapshot — taken before any
  // compose finishes — freezes flatblock fallbacks forever).
  const bRev = rc.buildingArtRev ?? 0;
  // Interior I-2: the focused (cutaway) building changes the static layer, so a focus
  // change must rebuild it. Empty when the reveal is off ⇒ key unchanged vs before.
  const cut = rc.cutawayBuildingId ?? '';
  return `${map.width}x${map.height}#${map.seed}:${layers}:${mode}:b${bRev}:c${cut}`;
}

/**
 * Caches the static draw layer, rebuilding only when its key changes. The returned
 * array's identity is stable across reuse (a new array only on rebuild), so the
 * scene can use it as a cache key downstream (e.g. the instance pack).
 */
export class StaticDrawListCache {
  private list: DrawItem[] | null = null;
  private key = '';
  private readonly build: StaticDrawListBuilder;

  constructor(build: StaticDrawListBuilder = defaultBuilder) {
    this.build = build;
  }

  /** The current static list, rebuilt iff the world's invalidation key changed. */
  get(rc: RenderContext, map: GameMap, ic: IsoItemCtx): DrawItem[] {
    const key = drawCacheKey(rc, map);
    if (!this.list || this.key !== key) {
      this.list = this.build(rc, ic);
      this.key = key;
    }
    return this.list;
  }

  /** Drop the cache so the next `get()` rebuilds (dirty-region seam / escape hatch). */
  invalidate(): void {
    this.list = null;
    this.key = '';
  }
}
