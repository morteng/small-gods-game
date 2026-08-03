/**
 * The sprite library: an IndexedDB-backed store of generated 2D assets,
 * provider-neutral by construction.
 *
 * It was born inside `pixellab.ts` and shares nothing with PixelLab any more —
 * a record's provider/model are just metadata, and any backend may write here.
 * Keep it that way: nothing provider-specific (request shapes, style enums,
 * API keys, cache-key recipes) belongs in this file.
 *
 * This module is a LEAF — it imports only types, the pure matcher and the IDB
 * timeout guard. `pixellab.ts` depends on it, never the reverse.
 */
import type {
  AssetKind,
  AssetLineage,
  AssetQuery,
  AssetSummary,
  LibraryAsset,
} from '@/core/types';

import { matchesAsset } from './asset-match';
import { withIdbTimeout } from './idb-guard';

/** HISTORICAL NAME. The store predates the provider split and holds assets from
 *  any backend; renaming the database would buy a migration and nothing else. */
const DB_NAME = 'smallgods.pixellab';
const DB_STORE = 'assets';
const DB_VERSION = 4;

/**
 * Lineage for records written before v4, and the fallback whenever provenance
 * is unknown. Every record that could exist at migration time was produced by
 * the PixelLab path, which always attaches the LPC palette anchor as
 * `color_image` — LPC pixels in the request. Guessing `'owned'` would be a
 * licence claim we cannot support; guessing share-alike only costs a credit
 * line. So the honest default is the conservative one, and it is applied here
 * rather than left undefined for a later reader to invent.
 */
const LEGACY_LINEAGE: AssetLineage = 'lpc-derived';

/** Recipe version legacy (pre-v3) records were generated under — the only one
 *  that had ever existed when v3 landed. Frozen here so the store never has to
 *  import a provider's live cache-key constant. */
const LEGACY_RECIPE_VERSION = 'v1';

/**
 * Bring one stored record up to the current schema, or return null if it is
 * already there.
 *
 * ONE cursor applies the WHOLE chain, deliberately. Two cursors opened on the
 * same store inside one upgrade transaction interleave: the later one can read
 * a record's pre-update value and write it back over the earlier one's
 * backfill. (The old v2 and v3 passes only survived that by having the v3 pass
 * re-apply every v2 default — a coincidence that stopped working the moment a
 * third pass appeared.) A single read-modify-write per record has no such
 * ordering to get wrong, and each version's defaults stay stated once.
 */
function upgradeRecord(v: Record<string, unknown>): Record<string, unknown> | null {
  if (v.schemaVersion === DB_VERSION) return null;
  return {
    ...v,
    // v1 → v2: curation + classification.
    curated: v.curated ?? 'pending',
    origin: v.origin ?? 'sandbox',
    kind: v.kind ?? 'unknown',
    tags: v.tags ?? [],
    // v2 → v3: generation provenance. Pre-v3 records could only have come from
    // the PixelLab path — the sole writer that existed at the time.
    provider: v.provider ?? 'pixellab',
    model: v.model ?? 'pixflux',
    style: v.style ?? 'pixel-art',
    recipeVersion: v.recipeVersion ?? LEGACY_RECIPE_VERSION,
    // v3 → v4: licence lineage.
    lineage: v.lineage ?? LEGACY_LINEAGE,
    // A record's schemaVersion tracks the DB version that introduced its shape.
    schemaVersion: DB_VERSION,
  };
}

/** Normalize tags: lowercase, trim, dedupe (preserve first-occurrence order),
 *  drop empties. Called at write time so reads can be dumb. */
export function normalizeTags(tags: string[] | undefined): string[] {
  if (!tags || tags.length === 0) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const t = raw.trim().toLowerCase();
    if (!t) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

// ─── IndexedDB store ──────────────────────────────────────────────────────────

/** Cached connection — reused across calls; closed by `_resetDbForTesting`. */
let _db: IDBDatabase | null = null;

/**
 * Test-only: close the cached DB connection so that tests can call
 * `indexedDB.deleteDatabase` without hitting a blocked state.
 * Not needed in production (the browser closes the connection on unload).
 */
export function _resetDbForTesting(): void {
  if (_db) { _db.close(); _db = null; }
}

function openDb(): Promise<IDBDatabase> {
  if (_db) return Promise.resolve(_db);
  // Guarded: a wedged backing store leaves open() pending forever, and boot
  // awaits the asset library (see idb-guard.ts). Transactions on a healthy,
  // already-open connection are left unguarded.
  return withIdbTimeout(new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = req.result;
      const tx = req.transaction!;
      const oldVersion = event.oldVersion;

      let store: IDBObjectStore;
      if (!db.objectStoreNames.contains(DB_STORE)) {
        store = db.createObjectStore(DB_STORE, { keyPath: 'key' });
      } else {
        store = tx.objectStore(DB_STORE);
      }

      // Data migration. The store is NOT assumed empty — anyone who generated
      // an asset under an older schema has records with real blobs and real
      // curation decisions, and dropping them to dodge a migration would
      // destroy that work. One pass carries every record to the current shape.
      const cursorReq = store.openCursor();
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor) return;
        const next = upgradeRecord(cursor.value as Record<string, unknown>);
        if (next) cursor.update(next);
        cursor.continue();
      };

      // Index creation, per the version that introduced each one. (createIndex
      // populates from the records already in the store, and picks up the
      // cursor's updates later in this same transaction.)
      if (oldVersion < 2) {
        if (!store.indexNames.contains('kind')) store.createIndex('kind', 'kind');
        if (!store.indexNames.contains('curated')) store.createIndex('curated', 'curated');
        if (!store.indexNames.contains('tags')) {
          store.createIndex('tags', 'tags', { multiEntry: true });
        }
      }
      if (oldVersion < 3) {
        if (!store.indexNames.contains('style')) store.createIndex('style', 'style');
      }
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  }), 'open');
}

export async function cacheGet(key: string): Promise<LibraryAsset | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readonly');
    const req = tx.objectStore(DB_STORE).get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function cachePut(asset: LibraryAsset): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).put(asset);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function cacheClear(): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ─── Queries ──────────────────────────────────────────────────────────────────

/**
 * Library query. Returns only assets with `curated === 'kept'`, narrowed by
 * `kind` (required) and optional tag/size filters. Results are ordered
 * newest-first by `generatedAt`. Default limit 16.
 */
export async function findAssets(q: AssetQuery): Promise<AssetSummary[]> {
  const db = await openDb();
  const tx = db.transaction(DB_STORE, 'readonly');
  const store = tx.objectStore(DB_STORE);
  const index = store.index('kind');

  return new Promise<AssetSummary[]>((resolve, reject) => {
    const matches: LibraryAsset[] = [];
    const limit = q.limit ?? 16;
    const req = index.openCursor(IDBKeyRange.only(q.kind));
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) {
        // Sort newest-first, then slice to limit, then project to summary
        matches.sort((a, b) => b.generatedAt - a.generatedAt);
        resolve(matches.slice(0, limit).map(toSummary));
        return;
      }
      const a = cursor.value as LibraryAsset;
      if (passesFilters(a, q)) matches.push(a);
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
    tx.onerror = () => reject(tx.error);
  });
}

/** All kept assets of a kind, newest-first, with full metadata. Unlike
 *  findAssets() this applies no tag/size filtering — callers (AssetLibrary)
 *  filter via asset-match. */
export async function listKeptSummaries(kind: AssetKind): Promise<AssetSummary[]> {
  const db = await openDb();
  const tx = db.transaction(DB_STORE, 'readonly');
  const index = tx.objectStore(DB_STORE).index('kind');
  return new Promise<AssetSummary[]>((resolve, reject) => {
    const matches: LibraryAsset[] = [];
    const req = index.openCursor(IDBKeyRange.only(kind));
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) {
        matches.sort((a, b) => b.generatedAt - a.generatedAt);
        resolve(matches.map(toSummary));
        return;
      }
      const a = cursor.value as LibraryAsset;
      if (a.curated === 'kept') matches.push(a);
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
    tx.onerror = () => reject(tx.error);
  });
}

function passesFilters(a: LibraryAsset, q: AssetQuery): boolean {
  if (a.curated !== 'kept') return false;
  if (!matchesAsset(
    { kind: a.kind, style: a.style ?? 'pixel-art', model: a.model ?? 'pixflux',
      provider: a.provider ?? 'pixellab', tags: a.tags, affinity: a.affinity,
      width: a.width, height: a.height },
    { kind: q.kind, style: q.style ?? (a.style ?? 'pixel-art'),
      model: q.model, provider: q.provider, size: q.size },
  )) return false;
  if (q.tagsAll && !q.tagsAll.every(t => a.tags.includes(t))) return false;
  if (q.tagsAny && !q.tagsAny.some(t => a.tags.includes(t))) return false;
  return true;
}

function toSummary(a: LibraryAsset): AssetSummary {
  return {
    id: a.key,
    kind: a.kind,
    tags: a.tags,
    prompt: a.prompt,
    description: a.description,
    width: a.width,
    height: a.height,
    addedAt: a.generatedAt,
    style: a.style ?? 'pixel-art',
    model: a.model ?? 'pixflux',
    provider: a.provider ?? 'pixellab',
    affinity: a.affinity,
    // Same conservative fallback as the migration: a record that somehow
    // reached us unstamped is treated as share-alike, never as owned.
    lineage: a.lineage ?? LEGACY_LINEAGE,
  };
}

/** Resolve an asset id (= LibraryAsset.key) to its blob, or null if missing. */
export async function getAssetBlob(id: string): Promise<Blob | null> {
  const entry = await cacheGet(id);
  return entry?.blob ?? null;
}

// ─── Curation actions ─────────────────────────────────────────────────────────

/** Read-modify-write a single asset. No-op if id is unknown. */
async function patchAsset(id: string, patch: Partial<LibraryAsset>): Promise<void> {
  const existing = await cacheGet(id);
  if (!existing) return;
  await cachePut({ ...existing, ...patch });
}

/** Mark an asset as kept (queryable by `findAssets`). No-op if id unknown. */
export async function markAssetKept(id: string): Promise<void> {
  await patchAsset(id, { curated: 'kept' });
}

/** Mark an asset as rejected (excluded from `findAssets`). No-op if id unknown. */
export async function markAssetRejected(id: string): Promise<void> {
  await patchAsset(id, { curated: 'rejected' });
}

/**
 * Patch caller-facing metadata. Any provided field is overwritten; omitted
 * fields are unchanged. Tags are re-normalized.
 *
 * `lineage` is deliberately NOT patchable here: it is a fact about how the
 * pixels were made, set by the pipeline that made them, not a curation opinion.
 */
export async function updateAssetMetadata(
  id: string,
  patch: Partial<Pick<LibraryAsset, 'kind' | 'tags' | 'description'>>,
): Promise<void> {
  const normalized: Partial<LibraryAsset> = { ...patch };
  if (patch.tags !== undefined) normalized.tags = normalizeTags(patch.tags);
  await patchAsset(id, normalized);
}

/** Diagnostic / dev-tool helper: list every asset (any curation status),
 *  ordered newest-first. Returns full LibraryAsset records (including blob). */
export async function listRecentAssets(limit = 20): Promise<LibraryAsset[]> {
  const db = await openDb();
  const tx = db.transaction(DB_STORE, 'readonly');
  const store = tx.objectStore(DB_STORE);
  return new Promise<LibraryAsset[]>((resolve, reject) => {
    const out: LibraryAsset[] = [];
    const req = store.openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) {
        out.sort((a, b) => b.generatedAt - a.generatedAt);
        resolve(out.slice(0, limit));
        return;
      }
      out.push(cursor.value as LibraryAsset);
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
  });
}
