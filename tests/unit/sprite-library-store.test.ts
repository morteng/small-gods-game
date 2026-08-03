// Behaviour parity for the store lifted out of pixellab.ts (C0), plus the new
// v4 `lineage` field. Nothing here may need a provider: the library is neutral.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import {
  cacheClear,
  cacheGet,
  cachePut,
  findAssets,
  getAssetBlob,
  listKeptSummaries,
  listRecentAssets,
  markAssetKept,
  markAssetRejected,
  normalizeTags,
  updateAssetMetadata,
  _resetDbForTesting,
} from '@/services/sprite-library';
import type { AssetKind, LibraryAsset } from '@/core/types';

beforeEach(async () => {
  await cacheClear();
});

// Helper to put a fully-formed library asset directly.
async function seed(asset: Partial<LibraryAsset> & {
  key: string; kind: AssetKind; tags?: string[];
}): Promise<void> {
  const full: LibraryAsset = {
    key: asset.key,
    schemaVersion: 4,
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
    provider: asset.provider ?? 'pixellab',
    model: asset.model ?? 'pixflux',
    style: 'pixel-art',
    recipeVersion: 'v1',
    lineage: asset.lineage ?? 'lpc-derived',
  };
  await cachePut(full);
}

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
// The DB name is historical — the store outlived its PixelLab origin.
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

describe('schema migrations', () => {
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

    // Now read via the module — this opens at v4 and runs the full migration chain
    const migrated = (await cacheGet('legacy-key-1')) as LibraryAsset | null;
    expect(migrated).not.toBeNull();
    expect(migrated!.schemaVersion).toBe(4);
    expect(migrated!.curated).toBe('pending');
    expect(migrated!.origin).toBe('sandbox');
    expect(migrated!.kind).toBe('unknown');
    expect(migrated!.tags).toEqual([]);
    expect(migrated!.prompt).toBe('legacy prompt');
  });

  it('backfills v2 records with provider/model/style/recipeVersion on upgrade', async () => {
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
    expect(migrated?.schemaVersion).toBe(4);
    expect(migrated?.provider).toBe('pixellab');
    expect(migrated?.model).toBe('pixflux');
    expect(migrated?.style).toBe('pixel-art');
    expect(migrated?.recipeVersion).toBeTruthy();
  });

  it('v3 → v4 stamps lineage on pre-existing records, keeping their blob and curation', async () => {
    const db = await openRawDb(3);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('assets', 'readwrite');
      tx.objectStore('assets').put({
        key: 'v3-record',
        schemaVersion: 3,
        blob: new Blob([new Uint8Array([9, 9])]),
        prompt: 'a curated stump',
        width: 64, height: 64,
        generatedAt: 2000,
        curated: 'kept',
        origin: 'official',
        kind: 'decoration',
        tags: ['stump'],
        provider: 'pixellab',
        model: 'pixflux',
        style: 'pixel-art',
        recipeVersion: 'v1',
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();

    const migrated = await cacheGet('v3-record');
    expect(migrated?.schemaVersion).toBe(4);
    // Provenance can't be reconstructed after the fact, so the migration takes
    // the conservative (share-alike) side rather than claiming ownership.
    expect(migrated?.lineage).toBe('lpc-derived');
    // The record survives intact — curated work is never dropped to dodge a migration.
    expect(migrated?.curated).toBe('kept');
    expect(migrated?.tags).toEqual(['stump']);
    expect(migrated?.blob).toBeTruthy();
  });

  it('creates the new indexes on upgrade', async () => {
    // Trigger an upgrade by reading once (opens at the current version)
    await cacheGet('does-not-exist');
    // Now inspect the schema — must open at the same version (4)
    const db = await openRawDb(4);
    const store = db.transaction('assets', 'readonly').objectStore('assets');
    const names = Array.from(store.indexNames);
    expect(names).toContain('kind');
    expect(names).toContain('curated');
    expect(names).toContain('tags');
    expect(names).toContain('style');
    db.close();
  });
});

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
      lineage: 'lpc-derived',
    });
    expect('blob' in r[0]).toBe(false);
  });
});

describe('listKeptSummaries', () => {
  it('returns every kept asset of a kind, newest-first, unfiltered by tags/size', async () => {
    await seed({ key: 'k1', kind: 'decoration', tags: ['tree'], generatedAt: 100 });
    await seed({ key: 'k2', kind: 'decoration', tags: [], width: 128, generatedAt: 200 });
    await seed({ key: 'p', kind: 'decoration', curated: 'pending', generatedAt: 300 });
    await seed({ key: 'other', kind: 'icon', generatedAt: 400 });

    const out = await listKeptSummaries('decoration');
    expect(out.map(s => s.id)).toEqual(['k2', 'k1']);
  });
});

describe('lineage', () => {
  it('round-trips a self-owned record without downgrading it', async () => {
    await seed({ key: 'own', kind: 'npc-sprite', lineage: 'owned' });
    expect((await cacheGet('own'))!.lineage).toBe('owned');
    expect((await listKeptSummaries('npc-sprite'))[0].lineage).toBe('owned');
  });

  it('is not editable through updateAssetMetadata (it is a fact, not an opinion)', async () => {
    await seed({ key: 'fix', kind: 'decoration', lineage: 'lpc-derived' });
    await updateAssetMetadata('fix', { tags: ['relabelled'] });
    expect((await cacheGet('fix'))!.lineage).toBe('lpc-derived');
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

  it('a pending asset becomes findable once kept, and hidden again once rejected', async () => {
    await seed({ key: 'trip', kind: 'decoration', curated: 'pending' });
    expect(await findAssets({ kind: 'decoration' })).toHaveLength(0);
    await markAssetKept('trip');
    expect((await findAssets({ kind: 'decoration' })).map(a => a.id)).toEqual(['trip']);
    await markAssetRejected('trip');
    expect(await findAssets({ kind: 'decoration' })).toHaveLength(0);
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
