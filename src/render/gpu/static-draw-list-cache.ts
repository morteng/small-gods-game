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
// ART-REV DEBOUNCE (boot choppiness, user-reported 2026-07-13): the parametric /
// generated art sources bump `buildingArtRev` PER PACK as async packs settle —
// including warm boots that only LOAD finished sprites from IDB. Honouring every
// bump meant one full ~10k-entity rebuild per pack, staggered over the whole
// loading tail: seconds of sub-10fps chop after every boot. The rev is therefore
// debounced — when ONLY the art rev moved, the stale list is served until
// ART_REV_REBUILD_COOLDOWN_MS has passed since the last rebuild, so buildings
// still texture incrementally (in ≤¾ s batches) but boot pays a handful of
// rebuilds instead of one per pack. Real world-key changes (map, layers, cutaway)
// and `invalidate()` still rebuild immediately.
//
// The draw builder is injectable so the cache logic (rebuild-on-key-change,
// reuse-on-match, invalidate, debounce) is unit-testable without a GPU or a real
// world.

import type { RenderContext, GameMap } from '@/core/types';
import type { DrawItem } from '@/render/iso/draw-list';
import type { IsoItemCtx } from '@/render/iso/iso-sprites';
import { buildEntityDrawList } from '@/render/iso/entity-draw-list';
import { isLayerHidden } from '@/render/layer-visibility';

/** Builds the full-map static draw list for a world. Injectable for tests. */
export type StaticDrawListBuilder = (rc: RenderContext, ic: IsoItemCtx) => DrawItem[];

/** Minimum ms between rebuilds that are driven ONLY by `buildingArtRev` bumps
 *  (async art packs settling). Long enough to coalesce a pack burst, short enough
 *  that streamed-in art still appears promptly. */
export const ART_REV_REBUILD_COOLDOWN_MS = 750;

const defaultBuilder: StaticDrawListBuilder = (rc, ic) => {
  const map = rc.map!;
  const full = { minTx: 0, minTy: 0, maxTx: map.width - 1, maxTy: map.height - 1 };
  return buildEntityDrawList(rc, full, ic, { only: 'static' });
};

/**
 * Coarse invalidation key for the cached STATIC draw layer, art-rev EXCLUDED (the
 * rev is debounced separately — see header). Camera AND NPCs are deliberately
 * excluded too — the static list is unculled (camera-independent) and NPCs render
 * in a separate per-frame layer, so neither should bust the cache.
 */
export function drawCacheKey(rc: RenderContext, map: GameMap): string {
  const dm = rc.devMode;
  const layers = `${+isLayerHidden('buildings', dm)}${+isLayerHidden('vegetation', dm)}`
    + `${+isLayerHidden('terrain', dm)}`;
  const mode = dm?.buildingRenderMode ?? 'auto';
  // Interior I-2: the focused (cutaway) building changes the static layer, so a focus
  // change must rebuild it. Empty when the reveal is off ⇒ key unchanged vs before.
  const cut = rc.cutawayBuildingId ?? '';
  return `${map.width}x${map.height}#${map.seed}:${layers}:${mode}:c${cut}`;
}

/**
 * Caches the static draw layer, rebuilding only when its key changes (immediately)
 * or the art rev moved and the debounce window has passed. The returned array's
 * identity is stable across reuse (a new array only on rebuild), so the scene can
 * use it as a cache key downstream (e.g. the instance pack).
 */
export class StaticDrawListCache {
  private list: DrawItem[] | null = null;
  private key = '';
  private artRev = -1;
  private lastBuildMs = -Infinity;
  private readonly build: StaticDrawListBuilder;

  constructor(build: StaticDrawListBuilder = defaultBuilder) {
    this.build = build;
  }

  /** The current static list. `nowMs` is injectable for tests; defaults to the
   *  wall clock. */
  get(rc: RenderContext, map: GameMap, ic: IsoItemCtx, nowMs?: number): DrawItem[] {
    const now = nowMs ?? (typeof performance !== 'undefined' ? performance.now() : 0);
    const key = drawCacheKey(rc, map);
    const rev = rc.buildingArtRev ?? 0;
    const worldChanged = !this.list || this.key !== key;
    // Art-rev-only change: rebuild only once the debounce window has passed. The
    // frame loop keeps ticking (each pack settle kicks a render), so the final
    // trailing rebuild always lands on the first frame past the cooldown.
    const artChanged = rev !== this.artRev
      && now - this.lastBuildMs >= ART_REV_REBUILD_COOLDOWN_MS;
    if (worldChanged || artChanged) {
      this.list = this.build(rc, ic);
      this.key = key;
      this.artRev = rev;
      this.lastBuildMs = now;
    }
    return this.list!;
  }

  /** Drop the cache so the next `get()` rebuilds immediately (dirty-region seam /
   *  escape hatch) — bypasses the art-rev debounce. */
  invalidate(): void {
    this.list = null;
    this.key = '';
    this.artRev = -1;
    this.lastBuildMs = -Infinity;
  }
}
