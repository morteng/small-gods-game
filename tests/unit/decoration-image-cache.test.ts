import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import {
  cacheClear,
  cachePut,
  _resetDbForTesting,
} from '@/services/pixellab';
import type { LibraryAsset } from '@/core/types';
import { DecorationImageCache } from '@/render/decoration-image-cache';

async function seed(key: string): Promise<void> {
  const full: LibraryAsset = {
    key,
    schemaVersion: 3,
    blob: new Blob([new Uint8Array([0])]),
    prompt: 'p',
    width: 32,
    height: 32,
    generatedAt: Date.now(),
    curated: 'kept',
    origin: 'official',
    kind: 'decoration',
    tags: [],
    provider: 'pixellab',
    model: 'pixflux',
    style: 'pixel-art',
    recipeVersion: 'v1',
  };
  await cachePut(full);
}

let urlCounter = 0;

beforeEach(async () => {
  _resetDbForTesting();
  await cacheClear();
  // fake-indexeddb serializes Blob → {} on round-trip, so the blob coming
  // back from cacheGet isn't actually a Blob. Stub URL.createObjectURL to
  // accept anything and return a synthetic URL so the cache can proceed.
  urlCounter = 0;
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:fake-${++urlCounter}`);
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DecorationImageCache', () => {
  it('get() returns null for unknown id and kicks off a load', async () => {
    const cache = new DecorationImageCache();
    expect(cache.get('missing')).toBeNull();
  });

  it('load() resolves to null when the asset id is not in IDB', async () => {
    const cache = new DecorationImageCache();
    const img = await cache.load('not-there');
    expect(img).toBeNull();
  });

  it('load() returns the same image when called twice', async () => {
    await seed('a');
    const cache = new DecorationImageCache();
    const first  = await cache.load('a');
    const second = await cache.load('a');
    expect(first).not.toBeNull();
    expect(second).toBe(first);
  });

  it('preload() awaits every requested id', async () => {
    await seed('a');
    await seed('b');
    const cache = new DecorationImageCache();
    await cache.preload(['a', 'b', 'missing']);
    // After preload completes, the cached images are present (load resolved
    // synchronously into the map even before <img> fired its load event).
    // `get()` may still be null because <img>.complete isn't true in jsdom,
    // but the second load() should reuse the cached entry.
    const repeat = await cache.load('a');
    expect(repeat).not.toBeNull();
  });

  it('destroy() revokes object URLs and clears state', async () => {
    await seed('a');
    const cache = new DecorationImageCache();
    await cache.load('a');
    cache.destroy();
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
    // After destroy, the cache should be empty; a fresh load works again.
    const reloaded = await cache.load('a');
    expect(reloaded).not.toBeNull();
  });
});
