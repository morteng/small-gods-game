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
// loading tail: seconds of sub-10fps chop after every boot. The debounce is
// TRAILING-EDGE with a max-latency bound (not a fixed cooldown — measured via
// __drawCacheStats: a fixed 750 ms cooldown still rebuilt every 750 ms while each
// rebuild's main-thread block starved IDB txn delivery, stretching the pack tail
// past 30 s — a vicious cycle). When ONLY the art rev moved, the rebuild waits for
// ART_REV_QUIET_MS of rev silence, so the main thread stays free and the IDB
// stream drains at full speed; ART_REV_MAX_LATENCY_MS bounds the wait so a long
// steady stream still textures incrementally. Real world-key changes (map,
// layers, cutaway) and `invalidate()` rebuild immediately.
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

/** An art-rev-driven rebuild waits for this much rev SILENCE first — while packs
 *  stream in, the main thread stays free so the IDB read pipeline drains at full
 *  speed instead of being starved by back-to-back list rebuilds. */
export const ART_REV_QUIET_MS = 600;
/** …but never waits longer than this from the first deferred bump, so a long
 *  steady pack stream still textures buildings incrementally. */
export const ART_REV_MAX_LATENCY_MS = 2500;

const defaultBuilder: StaticDrawListBuilder = (rc, ic) => {
  const map = rc.map!;
  const full = { minTx: 0, minTy: 0, maxTx: map.width - 1, maxTy: map.height - 1 };
  return buildEntityDrawList(rc, full, ic, { only: 'static' });
};

/** Rebuild diagnostics — `__drawCacheStats` in dev (mirrors `__composeStats`).
 *  `worldBuilds` = key changes (map/layers/cutaway), `artBuilds` = debounced
 *  art-rev pickups; `lastArtRev`/`lastMs` date the most recent rebuild. A healthy
 *  session stops accruing once art streaming ends — continued growth means
 *  something is churning the key or the rev. */
export const drawCacheStats = { worldBuilds: 0, artBuilds: 0, lastArtRev: -1, lastMs: 0, lastKey: '' };
if (typeof globalThis !== 'undefined') {
  (globalThis as Record<string, unknown>).__drawCacheStats = drawCacheStats;
}

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
  /** Wall-clock of the most recent OBSERVED rev change (quiet-window clock). */
  private revChangedMs = -Infinity;
  /** Wall-clock of the FIRST deferred rev change since the last rebuild
   *  (max-latency clock); NaN = nothing pending. */
  private pendingSinceMs = Number.NaN;
  private lastSeenRev = -1;
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

    // Track the rev stream: a new value (re)starts the quiet window and, if
    // nothing was pending yet, starts the max-latency clock.
    if (rev !== this.lastSeenRev) {
      this.lastSeenRev = rev;
      this.revChangedMs = now;
      if (rev !== this.artRev && Number.isNaN(this.pendingSinceMs)) this.pendingSinceMs = now;
    }
    // Trailing edge: rebuild once the stream has been quiet — or the bound hit.
    const artChanged = rev !== this.artRev
      && (now - this.revChangedMs >= ART_REV_QUIET_MS
        || now - this.pendingSinceMs >= ART_REV_MAX_LATENCY_MS);

    if (worldChanged || artChanged) {
      this.list = this.build(rc, ic);
      this.key = key;
      this.artRev = rev;
      this.pendingSinceMs = Number.NaN;
      if (worldChanged) drawCacheStats.worldBuilds++;
      else drawCacheStats.artBuilds++;
      drawCacheStats.lastArtRev = rev;
      drawCacheStats.lastMs = now;
      drawCacheStats.lastKey = key;
    }
    return this.list!;
  }

  /** Drop the cache so the next `get()` rebuilds immediately (dirty-region seam /
   *  escape hatch) — bypasses the art-rev debounce. */
  invalidate(): void {
    this.list = null;
    this.key = '';
    this.artRev = -1;
    this.lastSeenRev = -1;
    this.revChangedMs = -Infinity;
    this.pendingSinceMs = Number.NaN;
  }
}
