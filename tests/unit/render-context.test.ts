import { describe, it, expect } from 'vitest';
import { buildRenderContext } from '@/game/render-context';
import { createState } from '@/core/state';
import { AssetManager } from '@/render/asset-manager';
import { DecorationImageCache } from '@/render/decoration-image-cache';
import { createDevMode } from '@/dev/DevMode';
import type { ArtResolver } from '@/render/art-resolver';

/** Minimal ArtResolver stub for tests — peek always misses, warm is a no-op. */
const stubArtResolver: ArtResolver = {
  resolve: async () => null,
  peek: () => null,
  warm: () => {},
  clear: () => {},
} as unknown as ArtResolver;

describe('buildRenderContext', () => {
  it('maps state fields and uses viewport for canvas size; empty npcs when no world', () => {
    const state = createState();
    state.map = { width: 4, height: 4, tiles: [] } as any;
    const rc = buildRenderContext({
      state,
      viewport: { width: 800, height: 600 },
      sheets: new Map(),
      assets: new AssetManager(),
      decorationImages: new DecorationImageCache(),
      artResolver: stubArtResolver,
      buildingArtResolver: stubArtResolver,
      devMode: createDevMode(),
    });
    expect(rc.canvasWidth).toBe(800);
    expect(rc.canvasHeight).toBe(600);
    expect(rc.npcs).toEqual([]); // no world yet
    expect(rc.map).toBe(state.map);
    expect(rc.camera).toBe(state.camera);
    expect(rc.showLabels).toBe(state.showLabels);
  });

  it('uses world.query for npcs when world is present', () => {
    const state = createState();
    state.map = { width: 1, height: 1, tiles: [] } as any;
    state.world = { query: () => [] } as any;
    const rc = buildRenderContext({
      state,
      viewport: { width: 100, height: 100 },
      sheets: new Map(),
      assets: new AssetManager(),
      decorationImages: new DecorationImageCache(),
      artResolver: stubArtResolver,
      buildingArtResolver: stubArtResolver,
      devMode: createDevMode(),
    });
    expect(rc.npcs).toEqual([]);
    expect(rc.world).toBe(state.world);
  });

  it('resolveBuildingArt returns the cached image on a peek hit, null + warms on a miss', () => {
    const state = createState();
    state.map = { width: 1, height: 1, tiles: [] } as any;
    const img = { width: 128, height: 128 } as unknown as HTMLImageElement;
    const images = { get: (id: string) => (id === 'bid' ? img : null) } as unknown as DecorationImageCache;

    let warmed = false;
    const hit = { peek: () => 'bid', warm: () => { warmed = true; } } as unknown as ArtResolver;
    const rcHit = buildRenderContext({
      state, viewport: { width: 1, height: 1 }, sheets: new Map(),
      assets: new AssetManager(), decorationImages: images,
      artResolver: stubArtResolver, buildingArtResolver: hit, devMode: createDevMode(),
    });
    expect(rcHit.resolveBuildingArt!({ kind: 'cottage' } as any)).toBe(img);
    expect(warmed).toBe(false); // a hit does not warm

    let warmedMiss = false;
    const miss = { peek: () => null, warm: () => { warmedMiss = true; } } as unknown as ArtResolver;
    const rcMiss = buildRenderContext({
      state, viewport: { width: 1, height: 1 }, sheets: new Map(),
      assets: new AssetManager(), decorationImages: images,
      artResolver: stubArtResolver, buildingArtResolver: miss, devMode: createDevMode(),
    });
    expect(rcMiss.resolveBuildingArt!({ kind: 'cottage' } as any)).toBeNull();
    expect(warmedMiss).toBe(true); // a miss kicks a fire-and-forget warm
  });
});
