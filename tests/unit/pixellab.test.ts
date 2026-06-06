import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import {
  buildCacheKeyInput,
  buildRequestBody,
  cacheClear,
  cacheGet,
  cachePut,
  generate,
  loadApiKey,
  saveApiKey,
  clearApiKey,
  normalizeTags,
  findAssets,
  getAssetBlob,
  _resetDbForTesting,
  RECIPE_V,
} from '@/services/pixellab';
import type { AssetKind, LibraryAsset } from '@/core/types';

const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABh6FO1AAAAABJRU5ErkJggg==';

function mockFetch(impl: (url: string, init?: RequestInit) => Promise<Response>): void {
  vi.stubGlobal('fetch', vi.fn(impl as never));
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

beforeEach(async () => {
  await cacheClear();
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('buildCacheKeyInput', () => {
  const base = { prompt: 'priest', width: 64, height: 64 };

  it('is stable for identical opts', () => {
    expect(buildCacheKeyInput(base)).toEqual(buildCacheKeyInput({ ...base }));
  });

  it('differs when prompt differs', () => {
    expect(buildCacheKeyInput(base)).not.toEqual(buildCacheKeyInput({ ...base, prompt: 'farmer' }));
  });

  it('differs when size differs', () => {
    expect(buildCacheKeyInput(base)).not.toEqual(buildCacheKeyInput({ ...base, width: 32 }));
  });

  it('differs when seed differs', () => {
    expect(buildCacheKeyInput({ ...base, seed: 1 })).not.toEqual(buildCacheKeyInput({ ...base, seed: 2 }));
  });

  it('bakes recipe version into the key', () => {
    expect(buildCacheKeyInput(base)).toContain(RECIPE_V);
  });

  it('bakes default style enums into the key when not overridden', () => {
    const k = buildCacheKeyInput(base);
    expect(k).toContain('single color black outline');
    expect(k).toContain('basic shading');
    expect(k).toContain('medium detail');
  });

  it('differs guided (init_image) vs unguided', () => {
    expect(buildCacheKeyInput(base)).not.toEqual(
      buildCacheKeyInput({ ...base, initImage: 'AAAA', initImageStrength: 500 }),
    );
  });

  it('differs when palette anchors differ', () => {
    expect(buildCacheKeyInput({ ...base, paletteAnchors: ['#aaa'] })).not.toEqual(
      buildCacheKeyInput({ ...base, paletteAnchors: ['#bbb'] }),
    );
  });

  it('respects a per-call recipeVersion override', () => {
    expect(buildCacheKeyInput(base)).not.toEqual(
      buildCacheKeyInput({ ...base, recipeVersion: 'v2' }),
    );
  });
});

describe('buildRequestBody', () => {
  it('includes the LPC palette swatch as color_image and no_background:true', async () => {
    mockFetch(async () => new Response(new Uint8Array([0, 1, 2, 3]).buffer));
    const body = await buildRequestBody({ prompt: 'priest', width: 64, height: 64 });
    expect(body.no_background).toBe(true);
    expect(body.color_image).toMatchObject({ type: 'base64', format: 'png' });
    expect(body.color_image.base64.length).toBeGreaterThan(0);
    expect(body.outline).toBe('single color black outline');
    expect(body.shading).toBe('basic shading');
    expect(body.detail).toBe('medium detail');
    expect(body.image_size).toEqual({ width: 64, height: 64 });
  });

  it('attaches init_image + init_image_strength and drops color_image when guided', async () => {
    const body = await buildRequestBody({
      prompt: 'cottage', width: 128, height: 128, initImage: 'BASE64DATA', initImageStrength: 480,
    });
    expect(body.init_image).toMatchObject({ type: 'base64', base64: 'BASE64DATA', format: 'png' });
    expect(body.init_image_strength).toBe(480);
    expect(body.color_image).toBeUndefined();
  });

  it('defaults init_image_strength to 500 when omitted', async () => {
    const body = await buildRequestBody({
      prompt: 'cottage', width: 128, height: 128, initImage: 'BASE64DATA',
    });
    expect(body.init_image_strength).toBe(500);
  });
});

describe('generate', () => {
  it('hits API on cache miss, then serves from cache on second call', async () => {
    let calls = 0;
    mockFetch(async (url: string) => {
      if (url.includes('lpc-anchor.png')) {
        return new Response(new Uint8Array([0]).buffer);
      }
      calls++;
      return jsonResponse({ image: { base64: TINY_PNG_B64 }, usage: { type: 'usd', usd: 0 } });
    });

    const first = await generate('test-key', { prompt: 'priest', width: 64, height: 64 });
    expect(first.cached).toBe(false);
    expect(calls).toBe(1);
    expect(first.blob.size).toBeGreaterThan(0);

    const second = await generate('test-key', { prompt: 'priest', width: 64, height: 64 });
    expect(second.cached).toBe(true);
    expect(calls).toBe(1);  // no new network call
    expect(second.key).toBe(first.key);
  });

  it('throws on API error', async () => {
    mockFetch(async (url: string) => {
      if (url.includes('lpc-anchor.png')) return new Response(new Uint8Array([0]).buffer);
      return new Response('forbidden', { status: 403 });
    });
    await expect(generate('bad-key', { prompt: 'x', width: 32, height: 32 })).rejects.toThrow(/403/);
  });

  it('passes the API key as a bearer token', async () => {
    let seenAuth: string | null = null;
    mockFetch(async (url: string, init?: RequestInit) => {
      if (url.includes('lpc-anchor.png')) return new Response(new Uint8Array([0]).buffer);
      const headers = init?.headers as Record<string, string> | undefined;
      seenAuth = headers?.Authorization ?? null;
      return jsonResponse({ image: { base64: TINY_PNG_B64 }, usage: { type: 'usd', usd: 0 } });
    });
    await generate('my-secret', { prompt: 'p', width: 32, height: 32 });
    expect(seenAuth).toBe('Bearer my-secret');
  });
});

describe('API key storage', () => {
  it('round-trips through localStorage', () => {
    expect(loadApiKey()).toBeNull();
    saveApiKey('abc');
    expect(loadApiKey()).toBe('abc');
    clearApiKey();
    expect(loadApiKey()).toBeNull();
  });
});

describe('normalizeTags', () => {
  it('lowercases', () => {
    expect(normalizeTags(['Tree', 'ROCK'])).toEqual(['tree', 'rock']);
  });

  it('trims whitespace', () => {
    expect(normalizeTags(['  tree ', 'rock '])).toEqual(['tree', 'rock']);
  });

  it('dedupes after normalization', () => {
    expect(normalizeTags(['Tree', 'tree', 'TREE '])).toEqual(['tree']);
  });

  it('drops empty entries', () => {
    expect(normalizeTags(['tree', '', '   '])).toEqual(['tree']);
  });

  it('returns [] for undefined/empty input', () => {
    expect(normalizeTags(undefined)).toEqual([]);
    expect(normalizeTags([])).toEqual([]);
  });

  it('preserves order of first occurrence', () => {
    expect(normalizeTags(['ruin', 'tree', 'Ruin'])).toEqual(['ruin', 'tree']);
  });
});

// Helper: open the IDB directly at a given version to seed legacy data.
function openRawDb(version: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('smallgods.pixellab', version);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('assets')) {
        db.createObjectStore('assets', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

describe('schema migration v1 → v2', () => {
  beforeEach(async () => {
    // Close the module's cached DB connection so deleteDatabase isn't blocked.
    _resetDbForTesting();
    // Wipe IDB between migration tests so we always start fresh.
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase('smallgods.pixellab');
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    });
  });

  afterEach(() => {
    // Reset again after each migration test so subsequent tests start clean.
    _resetDbForTesting();
  });

  it('backfills legacy v1 records with safe defaults', async () => {
    // Seed a v1-shaped record directly
    const db = await openRawDb(1);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('assets', 'readwrite');
      tx.objectStore('assets').put({
        key: 'legacy-key-1',
        blob: new Blob([new Uint8Array([1, 2, 3])]),
        prompt: 'legacy prompt',
        width: 32,
        height: 32,
        generatedAt: 1000,
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();

    // Now read via the module — this opens at v3 and runs the full migration chain
    const migrated = (await cacheGet('legacy-key-1')) as LibraryAsset | null;
    expect(migrated).not.toBeNull();
    expect(migrated!.schemaVersion).toBe(3);
    expect(migrated!.curated).toBe('pending');
    expect(migrated!.origin).toBe('sandbox');
    expect(migrated!.kind).toBe('unknown');
    expect(migrated!.tags).toEqual([]);
    expect(migrated!.prompt).toBe('legacy prompt');
  });

  it('backfills v2 records with provider/model/style/recipeVersion on upgrade to v3', async () => {
    const db = await openRawDb(2);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('assets', 'readwrite');
      tx.objectStore('assets').put({
        key: 'v2-record',
        schemaVersion: 2,
        blob: new Blob([new Uint8Array([1])]),
        prompt: 'old prompt',
        width: 32, height: 32,
        generatedAt: 1000,
        curated: 'kept',
        origin: 'official',
        kind: 'decoration',
        tags: ['tree'],
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    const migrated = await cacheGet('v2-record');
    expect(migrated?.schemaVersion).toBe(3);
    expect(migrated?.provider).toBe('pixellab');
    expect(migrated?.model).toBe('pixflux');
    expect(migrated?.style).toBe('pixel-art');
    expect(migrated?.recipeVersion).toBeTruthy();
  });

  it('creates the new indexes on upgrade', async () => {
    // Trigger an upgrade by reading once (opens at v3)
    await cacheGet('does-not-exist');
    // Now inspect the schema — must open at same version (3)
    const db = await openRawDb(3);
    const store = db.transaction('assets', 'readonly').objectStore('assets');
    const names = Array.from(store.indexNames);
    expect(names).toContain('kind');
    expect(names).toContain('curated');
    expect(names).toContain('tags');
    expect(names).toContain('style');
    db.close();
  });
});

describe('generate — library metadata', () => {
  function mockGen(): void {
    mockFetch(async (url: string) => {
      if (url.includes('lpc-anchor.png')) return new Response(new Uint8Array([0]).buffer);
      return jsonResponse({ image: { base64: TINY_PNG_B64 }, usage: { type: 'usd', usd: 0 } });
    });
  }

  it('writes pending/sandbox/unknown defaults when opts have no metadata', async () => {
    mockGen();
    const r = await generate('k', { prompt: 'a-spooky-shrine', width: 32, height: 32 });
    const stored = await cacheGet(r.key);
    expect(stored).not.toBeNull();
    expect(stored!.curated).toBe('pending');
    expect(stored!.origin).toBe('sandbox');
    expect(stored!.kind).toBe('unknown');
    expect(stored!.tags).toEqual([]);
  });

  it('writes kept/official with caller metadata on official origin', async () => {
    mockGen();
    const r = await generate('k', {
      prompt: 'a-spooky-shrine-2',
      width: 32,
      height: 32,
      origin: 'official',
      kind: 'decoration',
      tags: ['Shrine', 'spooky'],
      description: 'a moss-covered shrine',
    });
    const stored = await cacheGet(r.key);
    expect(stored!.curated).toBe('kept');
    expect(stored!.origin).toBe('official');
    expect(stored!.kind).toBe('decoration');
    expect(stored!.tags).toEqual(['shrine', 'spooky']);   // normalized
    expect(stored!.description).toBe('a moss-covered shrine');
    expect(stored!.schemaVersion).toBe(3);
  });

  it('promotes sandbox entry to kept on later official cache hit', async () => {
    mockGen();
    // First call: sandbox
    const r1 = await generate('k', { prompt: 'twin-call', width: 32, height: 32 });
    expect((await cacheGet(r1.key))!.curated).toBe('pending');

    // Second call (same shape): official with metadata — should hit cache AND promote
    const r2 = await generate('k', {
      prompt: 'twin-call',
      width: 32,
      height: 32,
      origin: 'official',
      kind: 'decoration',
      tags: ['rune'],
      description: 'glowing rune',
    });
    expect(r2.cached).toBe(true);
    expect(r2.key).toBe(r1.key);

    const stored = await cacheGet(r2.key);
    expect(stored!.curated).toBe('kept');
    expect(stored!.origin).toBe('official');
    expect(stored!.kind).toBe('decoration');
    expect(stored!.tags).toEqual(['rune']);
    expect(stored!.description).toBe('glowing rune');
  });

  it('does NOT demote a kept entry on later sandbox cache hit', async () => {
    mockGen();
    // First: official → kept
    const r1 = await generate('k', {
      prompt: 'pinned',
      width: 32,
      height: 32,
      origin: 'official',
      kind: 'icon',
      tags: ['star'],
    });
    expect((await cacheGet(r1.key))!.curated).toBe('kept');

    // Second: sandbox — should hit cache and leave the entry alone
    await generate('k', { prompt: 'pinned', width: 32, height: 32 });
    const stored = await cacheGet(r1.key);
    expect(stored!.curated).toBe('kept');
    expect(stored!.kind).toBe('icon');
    expect(stored!.tags).toEqual(['star']);
  });
});

// Helper to put a fully-formed library asset directly (bypasses generate).
async function seed(asset: Partial<LibraryAsset> & {
  key: string; kind: AssetKind; tags?: string[];
}): Promise<void> {
  const full: LibraryAsset = {
    key: asset.key,
    schemaVersion: 3,
    blob: asset.blob ?? new Blob([new Uint8Array([0])]),
    prompt: asset.prompt ?? 'p',
    width: asset.width ?? 32,
    height: asset.height ?? 32,
    generatedAt: asset.generatedAt ?? Date.now(),
    curated: asset.curated ?? 'kept',
    origin: asset.origin ?? 'official',
    kind: asset.kind,
    tags: asset.tags ?? [],
    description: asset.description,
    provider: 'pixellab',
    model: 'pixflux',
    style: 'pixel-art',
    recipeVersion: 'v1',
  };
  await cachePut(full);
}

describe('findAssets', () => {
  it('returns only kept entries matching kind', async () => {
    await seed({ key: 'a', kind: 'decoration', curated: 'kept' });
    await seed({ key: 'b', kind: 'decoration', curated: 'pending' });
    await seed({ key: 'c', kind: 'decoration', curated: 'rejected' });
    await seed({ key: 'd', kind: 'icon', curated: 'kept' });

    const r = await findAssets({ kind: 'decoration' });
    const ids = r.map(a => a.id).sort();
    expect(ids).toEqual(['a']);
  });

  it('orders results newest-first by generatedAt', async () => {
    await seed({ key: 'old', kind: 'decoration', generatedAt: 100 });
    await seed({ key: 'new', kind: 'decoration', generatedAt: 200 });
    await seed({ key: 'mid', kind: 'decoration', generatedAt: 150 });

    const r = await findAssets({ kind: 'decoration' });
    expect(r.map(a => a.id)).toEqual(['new', 'mid', 'old']);
  });

  it('respects limit', async () => {
    for (let i = 0; i < 5; i++) {
      await seed({ key: `x${i}`, kind: 'decoration', generatedAt: i });
    }
    const r = await findAssets({ kind: 'decoration', limit: 2 });
    expect(r).toHaveLength(2);
  });

  it('defaults limit to 16', async () => {
    for (let i = 0; i < 20; i++) {
      await seed({ key: `y${i}`, kind: 'decoration', generatedAt: i });
    }
    const r = await findAssets({ kind: 'decoration' });
    expect(r).toHaveLength(16);
  });

  it('tagsAll AND-filters', async () => {
    await seed({ key: 'a', kind: 'decoration', tags: ['tree', 'oak'] });
    await seed({ key: 'b', kind: 'decoration', tags: ['tree', 'pine'] });
    await seed({ key: 'c', kind: 'decoration', tags: ['oak', 'leaf'] });

    const r = await findAssets({ kind: 'decoration', tagsAll: ['tree', 'oak'] });
    expect(r.map(a => a.id)).toEqual(['a']);
  });

  it('tagsAny OR-filters', async () => {
    await seed({ key: 'a', kind: 'decoration', tags: ['tree'] });
    await seed({ key: 'b', kind: 'decoration', tags: ['rock'] });
    await seed({ key: 'c', kind: 'decoration', tags: ['water'] });

    const r = await findAssets({ kind: 'decoration', tagsAny: ['tree', 'rock'] });
    expect(r.map(a => a.id).sort()).toEqual(['a', 'b']);
  });

  it('combines tagsAll and tagsAny correctly', async () => {
    await seed({ key: 'a', kind: 'decoration', tags: ['tree', 'oak', 'dead'] });   // matches both
    await seed({ key: 'b', kind: 'decoration', tags: ['tree', 'pine', 'alive'] }); // matches tagsAll only
    await seed({ key: 'c', kind: 'decoration', tags: ['tree', 'oak'] });           // matches tagsAll but no tagsAny

    const r = await findAssets({
      kind: 'decoration',
      tagsAll: ['tree', 'oak'],
      tagsAny: ['dead', 'alive'],
    });
    expect(r.map(a => a.id).sort()).toEqual(['a']);
  });

  it('size exact-matches', async () => {
    await seed({ key: 'a', kind: 'decoration', width: 32, height: 32 });
    await seed({ key: 'b', kind: 'decoration', width: 64, height: 64 });
    await seed({ key: 'c', kind: 'decoration', width: 32, height: 64 });

    const r = await findAssets({ kind: 'decoration', size: { w: 32, h: 32 } });
    expect(r.map(a => a.id)).toEqual(['a']);
  });

  it('returns AssetSummary shape (no blob)', async () => {
    await seed({
      key: 'a', kind: 'decoration', tags: ['tree'],
      prompt: 'an oak', description: 'old oak', width: 48, height: 48,
      generatedAt: 12345,
    });
    const r = await findAssets({ kind: 'decoration' });
    expect(r[0]).toEqual({
      id: 'a',
      kind: 'decoration',
      tags: ['tree'],
      prompt: 'an oak',
      description: 'old oak',
      width: 48,
      height: 48,
      addedAt: 12345,
      style: 'pixel-art',
      model: 'pixflux',
      provider: 'pixellab',
      affinity: undefined,
    });
    expect('blob' in r[0]).toBe(false);
  });
});

describe('getAssetBlob', () => {
  it('returns non-null for an existing id', async () => {
    await seed({ key: 'has-blob', kind: 'icon', blob: new Blob([new Uint8Array([7, 7, 7])]) });
    const result = await getAssetBlob('has-blob');
    // fake-indexeddb serialises Blob to {} in jsdom, but the field is present and truthy
    expect(result).not.toBeNull();
  });

  it('returns null for an unknown id', async () => {
    const blob = await getAssetBlob('does-not-exist');
    expect(blob).toBeNull();
  });
});

import {
  markAssetKept,
  markAssetRejected,
  updateAssetMetadata,
  listRecentAssets,
} from '@/services/pixellab';

describe('curation actions', () => {
  it('markAssetKept flips pending to kept', async () => {
    await seed({ key: 'x', kind: 'decoration', curated: 'pending' });
    await markAssetKept('x');
    expect((await cacheGet('x'))!.curated).toBe('kept');
  });

  it('markAssetRejected flips pending to rejected', async () => {
    await seed({ key: 'x', kind: 'decoration', curated: 'pending' });
    await markAssetRejected('x');
    expect((await cacheGet('x'))!.curated).toBe('rejected');
  });

  it('markAssetKept is a no-op on unknown id (no throw)', async () => {
    await expect(markAssetKept('ghost')).resolves.not.toThrow();
  });

  it('updateAssetMetadata patches kind/tags/description', async () => {
    await seed({
      key: 'x', kind: 'unknown', tags: ['old'], description: 'old-desc',
    });
    await updateAssetMetadata('x', {
      kind: 'decoration',
      tags: ['NEW', 'shiny'],
      description: 'new-desc',
    });
    const after = (await cacheGet('x'))!;
    expect(after.kind).toBe('decoration');
    expect(after.tags).toEqual(['new', 'shiny']);   // normalized
    expect(after.description).toBe('new-desc');
  });

  it('updateAssetMetadata leaves unspecified fields unchanged', async () => {
    await seed({
      key: 'x', kind: 'decoration', tags: ['tree'], description: 'an oak',
    });
    await updateAssetMetadata('x', { tags: ['oak'] });
    const after = (await cacheGet('x'))!;
    expect(after.kind).toBe('decoration');
    expect(after.tags).toEqual(['oak']);
    expect(after.description).toBe('an oak');
  });
});

describe('listRecentAssets', () => {
  it('returns all curation statuses, newest-first, respecting limit', async () => {
    await seed({ key: 'a', kind: 'decoration', curated: 'kept',     generatedAt: 100 });
    await seed({ key: 'b', kind: 'decoration', curated: 'pending',  generatedAt: 200 });
    await seed({ key: 'c', kind: 'decoration', curated: 'rejected', generatedAt: 150 });

    const r = await listRecentAssets(10);
    expect(r.map(a => a.key)).toEqual(['b', 'c', 'a']);

    const limited = await listRecentAssets(2);
    expect(limited).toHaveLength(2);
  });
});
