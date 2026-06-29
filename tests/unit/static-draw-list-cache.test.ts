import { describe, it, expect } from 'vitest';
import { StaticDrawListCache, drawCacheKey } from '@/render/gpu/static-draw-list-cache';
import type { RenderContext, GameMap } from '@/core/types';
import type { DrawItem } from '@/render/iso/draw-list';
import type { IsoItemCtx } from '@/render/iso/iso-sprites';

// Minimal stand-ins — the cache only reads map identity + devMode flags via the
// key, and passes rc/ic straight to the injected builder (which we stub).
function makeMap(over: Partial<GameMap> = {}): GameMap {
  return { width: 8, height: 8, seed: 1, ...over } as GameMap;
}
function makeRc(map: GameMap, devMode?: RenderContext['devMode']): RenderContext {
  return { map, devMode } as RenderContext;
}
const IC = {} as IsoItemCtx;

describe('drawCacheKey', () => {
  it('is stable for the same map + dev flags', () => {
    const map = makeMap();
    expect(drawCacheKey(makeRc(map), map)).toBe(drawCacheKey(makeRc(map), map));
  });

  it('changes with map size and seed', () => {
    const a = makeMap({ seed: 1 });
    const b = makeMap({ seed: 2 });
    const c = makeMap({ width: 16 });
    expect(drawCacheKey(makeRc(a), a)).not.toBe(drawCacheKey(makeRc(b), b));
    expect(drawCacheKey(makeRc(a), a)).not.toBe(drawCacheKey(makeRc(c), c));
  });

  it('changes with building render mode (a static-affecting dev flag)', () => {
    const map = makeMap();
    const auto = makeRc(map, { buildingRenderMode: 'auto' } as unknown as RenderContext['devMode']);
    const grey = makeRc(map, { buildingRenderMode: 'fallback' } as unknown as RenderContext['devMode']);
    expect(drawCacheKey(auto, map)).not.toBe(drawCacheKey(grey, map));
  });

  it('interior I-2: changes when the focused (cutaway) building changes, so a focus rebuilds the static layer', () => {
    const map = makeMap();
    const none = makeRc(map);
    const focusA = { ...makeRc(map), cutawayBuildingId: 'b1' } as RenderContext;
    const focusB = { ...makeRc(map), cutawayBuildingId: 'b2' } as RenderContext;
    expect(drawCacheKey(focusA, map)).not.toBe(drawCacheKey(none, map));
    expect(drawCacheKey(focusA, map)).not.toBe(drawCacheKey(focusB, map));
  });

  it('interior I-2: an absent/null cutaway id keeps the key identical to before (reveal-off is inert)', () => {
    const map = makeMap();
    const absent = makeRc(map);
    const nulled = { ...makeRc(map), cutawayBuildingId: null } as RenderContext;
    expect(drawCacheKey(nulled, map)).toBe(drawCacheKey(absent, map));
  });
});

describe('StaticDrawListCache', () => {
  it('builds once and reuses the SAME array across calls with an unchanged key', () => {
    let builds = 0;
    const cache = new StaticDrawListCache(() => { builds++; return [{} as DrawItem]; });
    const map = makeMap();
    const rc = makeRc(map);
    const first = cache.get(rc, map, IC);
    const second = cache.get(rc, map, IC);
    expect(builds).toBe(1);
    expect(second).toBe(first); // identity stable (downstream packs key off it)
  });

  it('rebuilds when the key changes', () => {
    let builds = 0;
    const cache = new StaticDrawListCache(() => { builds++; return []; });
    const a = makeMap({ seed: 1 });
    const b = makeMap({ seed: 2 });
    cache.get(makeRc(a), a, IC);
    cache.get(makeRc(b), b, IC);
    expect(builds).toBe(2);
  });

  it('does NOT rebuild when only the camera/NPCs would change (key excludes them)', () => {
    let builds = 0;
    const cache = new StaticDrawListCache(() => { builds++; return []; });
    const map = makeMap();
    // Same map identity + dev flags ⇒ same key, regardless of any camera motion the
    // caller does between frames (camera isn't part of rc here / isn't keyed).
    cache.get(makeRc(map), map, IC);
    cache.get(makeRc(map), map, IC);
    expect(builds).toBe(1);
  });

  it('rebuilds after invalidate()', () => {
    let builds = 0;
    const cache = new StaticDrawListCache(() => { builds++; return []; });
    const map = makeMap();
    cache.get(makeRc(map), map, IC);
    cache.invalidate();
    cache.get(makeRc(map), map, IC);
    expect(builds).toBe(2);
  });
});
