# Asset Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing PixelLab IndexedDB cache into a searchable, curated asset library with metadata (`kind`, `tags`, `description`, `curated`, `origin`) so future LLM agents can reuse sprites before generating new ones.

**Architecture:** Single IndexedDB store, schema-versioned (v1 → v2 migration backfills existing entries as `pending/unknown/sandbox`). New fields are populated on cache miss from caller-supplied opts; sandbox-origin entries can be promoted on a later official-origin cache hit. A structured `findAssets({kind, tagsAll?, tagsAny?, size?, limit?})` query returns only `kept` entries, sorted newest-first. Population this session is via the existing settings panel; no in-game consumer or agent stub.

**Tech Stack:** TypeScript (ES modules), IndexedDB (via the existing `openDb`/`cacheGet`/`cachePut` helpers in `src/services/pixellab.ts`), Vitest + `fake-indexeddb/auto` for unit tests, hand-rolled DOM for the settings panel.

**Design spec:** `docs/plans/2026-05-16-asset-library-design.md`

**Project gotcha (re-stated from CLAUDE.md and session brief):**
- `npm run build` is blocked by pre-existing Playwright `implicit-any` errors in `tests/e2e/*.spec.ts`. **Do not fix them.** Use `npx tsc --noEmit -p tsconfig.json` for type checks and `npm test` for unit tests.
- Hardware is slow; `npm test` takes 50-130s. Don't parallelize multi-minute commands.
- Conventional commit style. One commit per logical change.

---

## Files touched

- **Modify:** `src/core/types.ts` — replace `PixelLabCachedAsset` with `LibraryAsset`; add `AssetKind`, `CurationStatus`, `AssetOrigin`, `AssetQuery`, `AssetSummary`; extend `PixelLabGenerateOpts`.
- **Modify:** `src/services/pixellab.ts` — bump `DB_VERSION` to 2 with migration + indexes; extend `generate()`; add `findAssets`, `getAssetBlob`, `markAssetKept`, `markAssetRejected`, `updateAssetMetadata`, `normalizeTags`.
- **Modify:** `src/ui/settings-panel.ts` — add a "Library" section with kind/tags/description/origin fields on the generate form, plus a recent-entries list with Keep/Reject buttons.
- **Modify:** `tests/unit/pixellab.test.ts` — new tests across all of the above.

No changes to renderer, game state, world data, or any gameplay system.

---

## Task 1: Add types and rename PixelLabCachedAsset → LibraryAsset

**Files:**
- Modify: `src/core/types.ts:289-340` (the PixelLab integration section)

This is a pure type-level change. We add the new type aliases, expand `PixelLabGenerateOpts` with optional metadata fields, and rename `PixelLabCachedAsset` to `LibraryAsset` (one internal consumer in `pixellab.ts` — fixed in Task 3).

- [ ] **Step 1: Replace the PixelLab type section in `src/core/types.ts`**

Find the block starting at line 289 (the `// ─── PixelLab integration` comment) and ending at line 340 (after `PixelLabKeyStatus`). Replace with:

```ts
// ─── PixelLab integration (user-supplied API key) ─────────────────────────────

export type PixelLabOutline =
  | 'single color black outline'
  | 'single color outline'
  | 'selective outline'
  | 'lineless';

export type PixelLabShading =
  | 'flat shading'
  | 'basic shading'
  | 'medium shading'
  | 'detailed shading'
  | 'highly detailed shading';

export type PixelLabDetail = 'low detail' | 'medium detail' | 'highly detailed';

// ─── Asset library metadata ───────────────────────────────────────────────────

export type AssetKind =
  | 'decoration'
  | 'building'
  | 'npc-portrait'
  | 'npc-sprite'
  | 'icon'
  | 'terrain-stamp'
  | 'unknown';

export type CurationStatus = 'pending' | 'kept' | 'rejected';

export type AssetOrigin = 'sandbox' | 'official' | 'imported';

/** Options for a single PixelLab generation call. The client bakes in the
 *  project style recipe (color_image, outline, shading, detail) on top. */
export interface PixelLabGenerateOpts {
  prompt: string;
  width: number;
  height: number;
  /** Overrides for the baked-in style recipe (rarely used). */
  outline?: PixelLabOutline;
  shading?: PixelLabShading;
  detail?: PixelLabDetail;
  /** Deterministic seed for reproducibility. */
  seed?: number;

  // Library metadata. Required logically for 'official' origin (callers should
  // supply them); for 'sandbox' (default) they may be omitted and will default.
  kind?: AssetKind;
  tags?: string[];
  description?: string;
  origin?: AssetOrigin;
}

export interface PixelLabBalance {
  generationsRemaining: number;
  generationsTotal: number;
  creditsUsd: number;
}

/** A single asset in the library (also the cache record). */
export interface LibraryAsset {
  /** SHA-256 hex of the canonical call shape. Primary key. */
  key: string;
  schemaVersion: 2;

  blob: Blob;
  prompt: string;
  width: number;
  height: number;
  generatedAt: number;

  curated: CurationStatus;
  origin: AssetOrigin;

  kind: AssetKind;
  tags: string[];
  description?: string;
}

/** Structured library query — designed for the future LLM agent's tool call. */
export interface AssetQuery {
  kind: AssetKind;
  /** OR-match: result must contain at least one of these tags. */
  tagsAny?: string[];
  /** AND-match: result must contain all of these tags. */
  tagsAll?: string[];
  /** Exact-match dimensions. */
  size?: { w: number; h: number };
  /** Default 16. */
  limit?: number;
}

/** Metadata-only summary returned by `findAssets`. Callers fetch the blob
 *  separately via `getAssetBlob(id)`. */
export interface AssetSummary {
  id: string;
  kind: AssetKind;
  tags: string[];
  prompt: string;
  description?: string;
  width: number;
  height: number;
  addedAt: number;
}

export type PixelLabKeyStatus = 'missing' | 'unverified' | 'valid' | 'invalid';
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -v 'tests/e2e/' | head -40`
Expected: One error in `src/services/pixellab.ts` — `PixelLabCachedAsset` no longer exists. This is the consumer we fix in Task 3. No other errors outside `tests/e2e/`.

- [ ] **Step 3: Commit**

```bash
git add src/core/types.ts
git commit -m "feat(pixellab): library types (kind/tags/curation/origin) + LibraryAsset"
```

---

## Task 2: Implement and test `normalizeTags`

**Files:**
- Modify: `src/services/pixellab.ts` (add helper near the top, after the existing helpers)
- Modify: `tests/unit/pixellab.test.ts`

Tags must be lowercased, trimmed, deduped, and non-empty. We do this once at write time so reads are dumb.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/pixellab.test.ts`:

```ts
import { normalizeTags } from '@/services/pixellab';

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
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `npx vitest run tests/unit/pixellab.test.ts -t normalizeTags 2>&1 | tail -20`
Expected: FAIL with "normalizeTags is not exported" or similar.

- [ ] **Step 3: Implement `normalizeTags`**

In `src/services/pixellab.ts`, add after `arrayBufferToBase64` (~ line 42):

```ts
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
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `npx vitest run tests/unit/pixellab.test.ts -t normalizeTags 2>&1 | tail -10`
Expected: 6 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/services/pixellab.ts tests/unit/pixellab.test.ts
git commit -m "feat(pixellab): normalizeTags helper for library write path"
```

---

## Task 3: Bump DB schema to v2 with migration and indexes

**Files:**
- Modify: `src/services/pixellab.ts` (DB constants, `openDb`, type imports, the existing internal `PixelLabCachedAsset` reference)
- Modify: `tests/unit/pixellab.test.ts`

We bump `DB_VERSION` from 1 to 2. In `onupgradeneeded`, for every existing v1 record we add `schemaVersion: 2`, `curated: 'pending'`, `origin: 'sandbox'`, `kind: 'unknown'`, `tags: []`. We also create three new indexes on the store: `kind`, `curated`, and a multi-entry index on `tags`.

The cache helpers (`cacheGet`, `cachePut`, `cacheClear`) keep working. We rename their type from `PixelLabCachedAsset` to `LibraryAsset` (Task 1 removed the old name).

- [ ] **Step 1: Write the failing migration test**

Append to `tests/unit/pixellab.test.ts`:

```ts
import type { LibraryAsset } from '@/core/types';
import { cacheGet, cachePut } from '@/services/pixellab';

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
    // Wipe IDB between migration tests so we always start fresh
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase('smallgods.pixellab');
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    });
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

    // Now read via the module — this opens at v2 and runs the migration
    const migrated = (await cacheGet('legacy-key-1')) as LibraryAsset | null;
    expect(migrated).not.toBeNull();
    expect(migrated!.schemaVersion).toBe(2);
    expect(migrated!.curated).toBe('pending');
    expect(migrated!.origin).toBe('sandbox');
    expect(migrated!.kind).toBe('unknown');
    expect(migrated!.tags).toEqual([]);
    expect(migrated!.prompt).toBe('legacy prompt');
  });

  it('creates the new indexes on upgrade', async () => {
    // Trigger an upgrade by reading once
    await cacheGet('does-not-exist');
    // Now inspect the schema
    const db = await openRawDb(2);
    const store = db.transaction('assets', 'readonly').objectStore('assets');
    const names = Array.from(store.indexNames);
    expect(names).toContain('kind');
    expect(names).toContain('curated');
    expect(names).toContain('tags');
    db.close();
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `npx vitest run tests/unit/pixellab.test.ts -t "schema migration" 2>&1 | tail -20`
Expected: FAIL — record exists but lacks `schemaVersion`, or indexes missing.

- [ ] **Step 3: Update DB constants and `openDb` in `src/services/pixellab.ts`**

Replace the top constants block (currently `DB_NAME`, `DB_STORE`, `DB_VERSION`):

```ts
const DB_NAME = 'smallgods.pixellab';
const DB_STORE = 'assets';
const DB_VERSION = 2;
```

Replace the existing `openDb` function with:

```ts
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
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

      // v1 → v2: backfill metadata fields and add indexes
      if (oldVersion < 2) {
        // Backfill every existing record
        const cursorReq = store.openCursor();
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (!cursor) return;
          const v = cursor.value as Record<string, unknown>;
          // Only touch records that don't already have schemaVersion
          if (v.schemaVersion !== 2) {
            cursor.update({
              ...v,
              schemaVersion: 2,
              curated: 'pending',
              origin: 'sandbox',
              kind: 'unknown',
              tags: [],
            });
          }
          cursor.continue();
        };

        // Create new indexes
        if (!store.indexNames.contains('kind')) store.createIndex('kind', 'kind');
        if (!store.indexNames.contains('curated')) store.createIndex('curated', 'curated');
        if (!store.indexNames.contains('tags')) {
          store.createIndex('tags', 'tags', { multiEntry: true });
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
```

Replace the `PixelLabCachedAsset` import (which Task 1 removed) and the `cacheGet`/`cachePut` signatures. At the top of the file change:

```ts
import type {
  PixelLabBalance,
  PixelLabCachedAsset,
  PixelLabGenerateOpts,
  PixelLabKeyStatus,
} from '@/core/types';
```

to:

```ts
import type {
  AssetQuery,
  AssetSummary,
  LibraryAsset,
  PixelLabBalance,
  PixelLabGenerateOpts,
  PixelLabKeyStatus,
} from '@/core/types';
```

(`AssetQuery` and `AssetSummary` are used in later tasks; importing now keeps Task 3 the single import-management edit.)

In `cacheGet` and `cachePut`, change the type `PixelLabCachedAsset` to `LibraryAsset`:

```ts
async function cacheGet(key: string): Promise<LibraryAsset | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readonly');
    const req = tx.objectStore(DB_STORE).get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function cachePut(asset: LibraryAsset): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).put(asset);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
```

- [ ] **Step 4: Run migration tests — expect PASS**

Run: `npx vitest run tests/unit/pixellab.test.ts -t "schema migration" 2>&1 | tail -10`
Expected: 2 tests passed.

- [ ] **Step 5: Run the full file — verify nothing else broke**

Run: `npx vitest run tests/unit/pixellab.test.ts 2>&1 | tail -15`
Expected: all tests passing (existing 11 + new ones from Task 2 + 2 migration). Note: the existing `generate` cache-miss/hit test will still pass because the v1→v2 migration is invisible to fresh databases — the test runs `cacheClear` in `beforeEach`, so the next `openDb` creates a fresh v2 store.

If `generate` cache test breaks because the cached blob no longer has `curated`/`origin`/`kind`/`tags` fields, that's because the test runs `cachePut` directly with a v1 shape — fix in Task 4 (we'll change `generate` to write the full shape).

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -v 'tests/e2e/' | head -20`
Expected: no errors outside `tests/e2e/`.

- [ ] **Step 7: Commit**

```bash
git add src/services/pixellab.ts tests/unit/pixellab.test.ts
git commit -m "feat(pixellab): IndexedDB schema v2 with kind/tags/curated/origin migration"
```

---

## Task 4: Extend `generate()` with library metadata + curation + promotion

**Files:**
- Modify: `src/services/pixellab.ts` (the `generate` function and `cachePut` callsite)
- Modify: `tests/unit/pixellab.test.ts`

The cache key is unchanged: same call shape → same blob. The new behavior:
- On cache miss, `cachePut` writes the full `LibraryAsset` including metadata from opts. `curated` is `'kept'` for `origin: 'official'`, otherwise `'pending'`. `origin` defaults to `'sandbox'`.
- On cache hit, if `opts.origin === 'official'` and the existing entry is not yet `'kept'`, promote it: update `curated` to `'kept'` and merge in any new `kind`/`tags`/`description` from opts.

- [ ] **Step 1: Write failing tests**

Append to `tests/unit/pixellab.test.ts`:

```ts
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
    expect(stored!.schemaVersion).toBe(2);
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
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `npx vitest run tests/unit/pixellab.test.ts -t "generate — library metadata" 2>&1 | tail -20`
Expected: failures — current `cachePut` writes only the old shape, and there is no promotion path.

- [ ] **Step 3: Rewrite the `generate` function**

In `src/services/pixellab.ts`, replace the existing `generate` function (currently lines ~202-237) with:

```ts
export async function generate(
  apiKey: string,
  opts: PixelLabGenerateOpts,
): Promise<GenerateResult> {
  const key = await sha256Hex(buildCacheKeyInput(opts));
  const origin = opts.origin ?? 'sandbox';
  const hit = await cacheGet(key);

  if (hit) {
    // Promotion: if caller asked for official origin and the existing entry
    // is not yet kept, upgrade it in place with the caller's metadata.
    if (origin === 'official' && hit.curated !== 'kept') {
      const promoted: LibraryAsset = {
        ...hit,
        curated: 'kept',
        origin: 'official',
        kind: opts.kind ?? hit.kind,
        tags: opts.tags ? normalizeTags(opts.tags) : hit.tags,
        description: opts.description ?? hit.description,
      };
      await cachePut(promoted);
    }
    return { blob: hit.blob, cached: true, key };
  }

  const body = await buildRequestBody(opts);
  const res = await fetch(`${API_BASE}/create-image-pixflux`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`generate: HTTP ${res.status} ${text}`.trim());
  }
  const json = await res.json();
  const b64 = json?.image?.base64;
  if (!b64) throw new Error('generate: missing image.base64 in response');

  const blob = base64ToBlob(b64);
  const asset: LibraryAsset = {
    key,
    schemaVersion: 2,
    blob,
    prompt: opts.prompt,
    width: opts.width,
    height: opts.height,
    generatedAt: Date.now(),
    curated: origin === 'official' ? 'kept' : 'pending',
    origin,
    kind: opts.kind ?? 'unknown',
    tags: normalizeTags(opts.tags),
    description: opts.description,
  };
  await cachePut(asset);
  return { blob, cached: false, key };
}
```

- [ ] **Step 4: Run the new tests — expect PASS**

Run: `npx vitest run tests/unit/pixellab.test.ts -t "generate — library metadata" 2>&1 | tail -15`
Expected: 4 tests passed.

- [ ] **Step 5: Run the existing `generate` tests too**

Run: `npx vitest run tests/unit/pixellab.test.ts -t "generate" 2>&1 | tail -15`
Expected: all `describe('generate', …)` tests still pass (the original 3 cache + auth tests, plus the 4 new ones = 7).

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -v 'tests/e2e/' | head -20`
Expected: no errors outside `tests/e2e/`.

- [ ] **Step 7: Commit**

```bash
git add src/services/pixellab.ts tests/unit/pixellab.test.ts
git commit -m "feat(pixellab): generate() writes library metadata; sandbox→official promotion"
```

---

## Task 5: Implement `findAssets`

**Files:**
- Modify: `src/services/pixellab.ts` (new exported function)
- Modify: `tests/unit/pixellab.test.ts`

Structured query. Only returns `kept`. Ordered newest-first. Implementation strategy: use the `kind` index to narrow, then filter in memory by `tagsAll`/`tagsAny`/`size`/`curated === 'kept'`. Counts are small (hundreds) — no compound index needed.

- [ ] **Step 1: Write failing tests**

Append to `tests/unit/pixellab.test.ts`:

```ts
import { findAssets } from '@/services/pixellab';

import type { AssetKind } from '@/core/types';
import { cachePut } from '@/services/pixellab';

// Helper to put a fully-formed library asset directly (bypasses generate).
async function seed(asset: Partial<LibraryAsset> & {
  key: string; kind: AssetKind; tags?: string[];
}): Promise<void> {
  const full: LibraryAsset = {
    key: asset.key,
    schemaVersion: 2,
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
    });
    expect('blob' in r[0]).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `npx vitest run tests/unit/pixellab.test.ts -t findAssets 2>&1 | tail -20`
Expected: FAIL — `findAssets` not exported.

- [ ] **Step 3: Implement `findAssets`**

Add to `src/services/pixellab.ts` (after the `cacheClear` function, before the trailing re-export line at the bottom):

```ts
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
  });
}

function passesFilters(a: LibraryAsset, q: AssetQuery): boolean {
  if (a.curated !== 'kept') return false;
  if (q.size && (a.width !== q.size.w || a.height !== q.size.h)) return false;
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
  };
}
```

Note: `cachePut` is already exported at the bottom (`export { cacheGet, cachePut, cacheClear };`) — the seed helper in the test relies on that.

- [ ] **Step 4: Run tests — expect PASS**

Run: `npx vitest run tests/unit/pixellab.test.ts -t findAssets 2>&1 | tail -15`
Expected: 9 tests passed.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -v 'tests/e2e/' | head -20`
Expected: no errors outside `tests/e2e/`.

- [ ] **Step 6: Commit**

```bash
git add src/services/pixellab.ts tests/unit/pixellab.test.ts
git commit -m "feat(pixellab): findAssets(kind, tagsAll?, tagsAny?, size?, limit?) library query"
```

---

## Task 6: Implement `getAssetBlob`

**Files:**
- Modify: `src/services/pixellab.ts`
- Modify: `tests/unit/pixellab.test.ts`

Trivial sibling of `findAssets` — fetch the blob for a given id (= `LibraryAsset.key`). Returns `null` if not found.

- [ ] **Step 1: Write failing tests**

Append to `tests/unit/pixellab.test.ts`:

```ts
import { getAssetBlob } from '@/services/pixellab';

describe('getAssetBlob', () => {
  it('returns the blob for an existing id', async () => {
    const bytes = new Uint8Array([7, 7, 7]);
    await seed({ key: 'has-blob', kind: 'icon', blob: new Blob([bytes]) });
    const blob = await getAssetBlob('has-blob');
    expect(blob).not.toBeNull();
    const buf = new Uint8Array(await blob!.arrayBuffer());
    expect(Array.from(buf)).toEqual([7, 7, 7]);
  });

  it('returns null for an unknown id', async () => {
    const blob = await getAssetBlob('does-not-exist');
    expect(blob).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `npx vitest run tests/unit/pixellab.test.ts -t getAssetBlob 2>&1 | tail -10`
Expected: FAIL — `getAssetBlob` not exported.

- [ ] **Step 3: Implement `getAssetBlob`**

Add to `src/services/pixellab.ts`, near `findAssets`:

```ts
/** Resolve an asset id (= LibraryAsset.key) to its blob, or null if missing. */
export async function getAssetBlob(id: string): Promise<Blob | null> {
  const entry = await cacheGet(id);
  return entry?.blob ?? null;
}
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `npx vitest run tests/unit/pixellab.test.ts -t getAssetBlob 2>&1 | tail -10`
Expected: 2 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/services/pixellab.ts tests/unit/pixellab.test.ts
git commit -m "feat(pixellab): getAssetBlob(id) resolver"
```

---

## Task 7: Curation actions — `markAssetKept`, `markAssetRejected`, `updateAssetMetadata`

**Files:**
- Modify: `src/services/pixellab.ts`
- Modify: `tests/unit/pixellab.test.ts`

These are the dev-curation knobs. The settings panel calls them; a future agent could too. All three are read-modify-write on a single key.

- [ ] **Step 1: Write failing tests**

Append to `tests/unit/pixellab.test.ts`:

```ts
import {
  markAssetKept,
  markAssetRejected,
  updateAssetMetadata,
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
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `npx vitest run tests/unit/pixellab.test.ts -t "curation actions" 2>&1 | tail -20`
Expected: FAIL — functions not exported.

- [ ] **Step 3: Implement curation actions**

Add to `src/services/pixellab.ts`, near `findAssets`:

```ts
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
 */
export async function updateAssetMetadata(
  id: string,
  patch: Partial<Pick<LibraryAsset, 'kind' | 'tags' | 'description'>>,
): Promise<void> {
  const normalized: Partial<LibraryAsset> = { ...patch };
  if (patch.tags !== undefined) normalized.tags = normalizeTags(patch.tags);
  await patchAsset(id, normalized);
}

async function patchAsset(id: string, patch: Partial<LibraryAsset>): Promise<void> {
  const existing = await cacheGet(id);
  if (!existing) return;
  await cachePut({ ...existing, ...patch });
}
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `npx vitest run tests/unit/pixellab.test.ts -t "curation actions" 2>&1 | tail -15`
Expected: 5 tests passed.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -v 'tests/e2e/' | head -20`
Expected: no errors outside `tests/e2e/`.

- [ ] **Step 6: Commit**

```bash
git add src/services/pixellab.ts tests/unit/pixellab.test.ts
git commit -m "feat(pixellab): markAssetKept/Rejected + updateAssetMetadata curation actions"
```

---

## Task 8: Settings-panel library section (population UI)

**Files:**
- Modify: `src/ui/settings-panel.ts`

This is the only UI built this session. Add a "Library" section below the existing Test-generate flow:
- A generate-with-metadata form: prompt, width/height (default 32), `kind` select, `tags` (comma-separated), `description`, `origin` (sandbox/official) toggle. Generate button.
- A "Recent entries" list (top 20 by `generatedAt`, regardless of curation) with thumbnail + prompt + curation badge + Keep/Reject buttons.
- Refresh the list after each generation or curation action.

The existing Test-generate flow stays as-is — it remains the quick "verify the key works" affordance. The new section is for *library population*.

Because this is UI built incrementally, we don't TDD it line-by-line. Instead, after wiring it up, **the engineer must manually verify in the browser** (see Step 7).

- [ ] **Step 1: Add CSS for the library section**

In `src/ui/settings-panel.ts`, append to the `STYLE` constant (before the closing backtick on line 57):

```ts
// (Append these rules to the existing template literal)
.sg-set-divider { height: 1px; background: #2b2b36; margin: 4px 0; }
.sg-set-section-title { font-size: 12px; font-weight: 600; color: #e6e6ea; }
.sg-set-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.sg-set-select { all: unset; background: #0e0e12; border: 1px solid #2b2b36;
  border-radius: 4px; padding: 6px 8px; font: 12px ui-monospace,monospace;
  color: #e6e6ea; cursor: pointer; }
.sg-set-select:focus { border-color: #4a4a5a; }
.sg-set-textarea { all: unset; background: #0e0e12; border: 1px solid #2b2b36;
  border-radius: 4px; padding: 6px 8px; font: 12px ui-monospace,monospace;
  color: #e6e6ea; min-height: 24px; resize: vertical; }
.sg-set-toggle { display: inline-flex; gap: 4px; }
.sg-set-toggle button { all: unset; cursor: pointer; padding: 4px 8px;
  border-radius: 4px; font-size: 11px; background: rgba(255,255,255,0.06);
  color: #9ea0aa; }
.sg-set-toggle button.active { background: #FFD54F; color: #1a1a1f; }
.sg-set-list { display: flex; flex-direction: column; gap: 6px;
  max-height: 280px; overflow-y: auto; padding-right: 4px; }
.sg-set-item { display: flex; gap: 8px; align-items: center; padding: 6px;
  border: 1px solid #2b2b36; border-radius: 4px; background: #14141a; }
.sg-set-item img { image-rendering: pixelated; image-rendering: crisp-edges;
  width: 40px; height: 40px; background:
    repeating-conic-gradient(#1e1e26 0% 25%, #14141a 0% 50%) 50% / 4px 4px; }
.sg-set-item-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.sg-set-item-prompt { font-size: 11px; color: #e6e6ea; overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap; }
.sg-set-item-meta { font-size: 10px; color: #9ea0aa; font-family: ui-monospace,monospace; }
.sg-set-badge { display: inline-block; padding: 1px 5px; border-radius: 3px;
  font-size: 9px; font-family: ui-monospace,monospace; letter-spacing: 0.04em;
  text-transform: uppercase; margin-right: 4px; }
.sg-set-badge.kept    { background: rgba(74,222,128,0.15); color: #4ade80; }
.sg-set-badge.pending { background: rgba(159,216,255,0.10); color: #9fd8ff; }
.sg-set-badge.rejected{ background: rgba(239,68,68,0.12); color: #ef4444; }
.sg-set-item-actions { display: flex; gap: 4px; }
.sg-set-mini { all: unset; cursor: pointer; padding: 3px 7px; border-radius: 3px;
  font-size: 10px; background: rgba(255,255,255,0.06); color: #e6e6ea; }
.sg-set-mini:hover { background: rgba(255,255,255,0.12); }
.sg-set-mini.keep:hover { background: rgba(74,222,128,0.20); color: #4ade80; }
.sg-set-mini.rej:hover  { background: rgba(239,68,68,0.20);  color: #ef4444; }
.sg-set-modal { max-height: calc(100vh - 40px); overflow-y: auto; }
```

- [ ] **Step 2: Update imports**

At the top of `src/ui/settings-panel.ts`, replace the existing imports from `@/services/pixellab`:

```ts
import type { AssetKind, AssetOrigin, PixelLabBalance, PixelLabKeyStatus } from '@/core/types';
import {
  clearApiKey,
  fetchBalance,
  findAssets,
  generate,
  getAssetBlob,
  loadApiKey,
  markAssetKept,
  markAssetRejected,
  saveApiKey,
} from '@/services/pixellab';
```

We don't import `LibraryAsset` directly — we work with `AssetSummary` from `findAssets` plus blobs from `getAssetBlob`. We do need `markAssetKept`/`markAssetRejected` for the buttons.

But wait — Keep/Reject in the recent-entries list needs to see pending entries too, not just kept ones. `findAssets` filters those out. We need a small new helper. Add it before Step 3.

- [ ] **Step 3: Add `listRecentAssets` helper in `src/services/pixellab.ts`**

Add near `findAssets`:

```ts
/** Diagnostic / dev-tool helper: list every asset (any curation status),
 *  ordered newest-first. Includes the blob URL via the cached Blob. */
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
```

Add a small test for it in `tests/unit/pixellab.test.ts`:

```ts
import { listRecentAssets } from '@/services/pixellab';

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
```

Run: `npx vitest run tests/unit/pixellab.test.ts -t listRecentAssets 2>&1 | tail -10`
Expected: 1 test passed.

- [ ] **Step 4: Update `settings-panel.ts` imports**

Replace the existing import block at the top of `src/ui/settings-panel.ts` with:

```ts
import type { AssetKind, AssetOrigin, LibraryAsset, PixelLabBalance, PixelLabKeyStatus } from '@/core/types';
import {
  clearApiKey,
  fetchBalance,
  generate,
  listRecentAssets,
  loadApiKey,
  markAssetKept,
  markAssetRejected,
  saveApiKey,
} from '@/services/pixellab';
```

`listRecentAssets` returns full `LibraryAsset` records (including the blob), so we don't need `getAssetBlob` or `findAssets` in this file. The future right-click decoration flow will import those.

- [ ] **Step 5: Extend `UiRefs` and the modal DOM**

Replace the existing `UiRefs` interface (currently lines 67-74) with:

```ts
interface LibRefs {
  prompt: HTMLInputElement;
  size: HTMLInputElement;
  kind: HTMLSelectElement;
  tags: HTMLInputElement;
  description: HTMLTextAreaElement;
  originSandbox: HTMLButtonElement;
  originOfficial: HTMLButtonElement;
  genBtn: HTMLButtonElement;
  list: HTMLDivElement;
  status: HTMLDivElement;
}

interface UiRefs {
  input: HTMLInputElement;
  saveBtn: HTMLButtonElement;
  testBtn: HTMLButtonElement;
  clearBtn: HTMLButtonElement;
  status: HTMLDivElement;
  preview: HTMLDivElement;
  lib: LibRefs;
}
```

In the `createSettingsPanel` function, **after** the line `modal.appendChild(preview);` (currently line 160) and **before** `container.appendChild(overlay);` (line 162), insert:

```ts
  // ─── Library section ─────────────────────────────────────────────────────
  modal.appendChild(el('div', 'sg-set-divider'));
  modal.appendChild(el('div', 'sg-set-section-title', 'Library'));
  const libSub = el('div', 'sg-set-sub',
    'Generate with metadata. Sandbox entries stay "pending" until you Keep them. Official entries auto-keep.');
  modal.appendChild(libSub);

  // Prompt + size row
  const libPromptRow = el('div', 'sg-set-row');
  libPromptRow.appendChild(el('label', 'sg-set-label', 'Prompt'));
  const libPrompt = el('input', 'sg-set-input') as HTMLInputElement;
  libPrompt.placeholder = 'e.g. an ancient moss-covered shrine, glowing runes';
  libPromptRow.appendChild(libPrompt);
  modal.appendChild(libPromptRow);

  const libGrid1 = el('div', 'sg-set-grid2');
  const sizeCol = el('div', 'sg-set-row');
  sizeCol.appendChild(el('label', 'sg-set-label', 'Size (px, square)'));
  const libSize = el('input', 'sg-set-input') as HTMLInputElement;
  libSize.type = 'number';
  libSize.value = '32';
  libSize.min = '16';
  libSize.max = '128';
  libSize.step = '16';
  sizeCol.appendChild(libSize);
  libGrid1.appendChild(sizeCol);

  const kindCol = el('div', 'sg-set-row');
  kindCol.appendChild(el('label', 'sg-set-label', 'Kind'));
  const libKind = el('select', 'sg-set-select') as HTMLSelectElement;
  for (const k of ['decoration', 'building', 'npc-portrait', 'npc-sprite', 'icon', 'terrain-stamp'] as AssetKind[]) {
    const o = el('option') as HTMLOptionElement;
    o.value = k; o.textContent = k;
    libKind.appendChild(o);
  }
  kindCol.appendChild(libKind);
  libGrid1.appendChild(kindCol);
  modal.appendChild(libGrid1);

  // Tags
  const tagsRow = el('div', 'sg-set-row');
  tagsRow.appendChild(el('label', 'sg-set-label', 'Tags (comma-separated)'));
  const libTags = el('input', 'sg-set-input') as HTMLInputElement;
  libTags.placeholder = 'shrine, mossy, glowing';
  tagsRow.appendChild(libTags);
  modal.appendChild(tagsRow);

  // Description
  const descRow = el('div', 'sg-set-row');
  descRow.appendChild(el('label', 'sg-set-label', 'Description (optional)'));
  const libDesc = el('textarea', 'sg-set-textarea') as HTMLTextAreaElement;
  libDesc.rows = 2;
  descRow.appendChild(libDesc);
  modal.appendChild(descRow);

  // Origin toggle + generate button
  const libActions = el('div', 'sg-set-actions');
  const originToggle = el('div', 'sg-set-toggle');
  const originSandbox  = el('button', 'sg-set-mini active', 'sandbox')  as HTMLButtonElement;
  const originOfficial = el('button', 'sg-set-mini',         'official') as HTMLButtonElement;
  originToggle.append(originSandbox, originOfficial);
  originSandbox.addEventListener('click', () => {
    originSandbox.classList.add('active'); originOfficial.classList.remove('active');
  });
  originOfficial.addEventListener('click', () => {
    originOfficial.classList.add('active'); originSandbox.classList.remove('active');
  });
  libActions.appendChild(originToggle);

  const libGen = el('button', 'sg-set-btn primary', 'Generate to library') as HTMLButtonElement;
  libActions.appendChild(libGen);
  modal.appendChild(libActions);

  const libStatus = el('div', 'sg-set-status');
  libStatus.style.display = 'none';
  modal.appendChild(libStatus);

  // Recent entries list
  modal.appendChild(el('div', 'sg-set-label', 'Recent entries'));
  const libList = el('div', 'sg-set-list');
  modal.appendChild(libList);
```

And update `refs` (line 164) to:

```ts
  const refs: UiRefs = {
    input, saveBtn, testBtn, clearBtn, status, preview,
    lib: {
      prompt: libPrompt,
      size: libSize,
      kind: libKind,
      tags: libTags,
      description: libDesc,
      originSandbox,
      originOfficial,
      genBtn: libGen,
      list: libList,
      status: libStatus,
    },
  };
```

- [ ] **Step 6: Add the library handler functions**

Add to `src/ui/settings-panel.ts` (at the bottom, after `onClear`):

```ts
function getLibOrigin(refs: UiRefs): AssetOrigin {
  return refs.lib.originOfficial.classList.contains('active') ? 'official' : 'sandbox';
}

function parseLibTags(raw: string): string[] {
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

async function onLibGenerate(refs: UiRefs): Promise<void> {
  const key = loadApiKey();
  if (!key) {
    setStatus(refs.lib.status, 'bad', 'Save a key first.');
    return;
  }
  const prompt = refs.lib.prompt.value.trim();
  if (!prompt) {
    setStatus(refs.lib.status, 'bad', 'Prompt is required.');
    return;
  }
  const size = Math.max(16, Math.min(128, Number(refs.lib.size.value) || 32));
  setStatus(refs.lib.status, 'info', `Generating ${size}×${size}…`);
  refs.lib.genBtn.disabled = true;
  try {
    const t0 = performance.now();
    const result = await generate(key, {
      prompt,
      width:  size,
      height: size,
      kind:        refs.lib.kind.value as AssetKind,
      tags:        parseLibTags(refs.lib.tags.value),
      description: refs.lib.description.value.trim() || undefined,
      origin:      getLibOrigin(refs),
    });
    const ms = Math.round(performance.now() - t0);
    setStatus(refs.lib.status, 'ok',
      `OK${result.cached ? ' (cache hit)' : ''} · ${ms}ms · key…${result.key.slice(0, 8)}`);
    await refreshLibList(refs);
  } catch (err) {
    setStatus(refs.lib.status, 'bad', `Failed: ${(err as Error).message}`);
  } finally {
    refs.lib.genBtn.disabled = false;
  }
}

async function refreshLibList(refs: UiRefs): Promise<void> {
  const items = await listRecentAssets(20);
  while (refs.lib.list.firstChild) refs.lib.list.removeChild(refs.lib.list.firstChild);
  if (items.length === 0) {
    const empty = el('div', 'sg-set-item-meta', '(no entries yet)');
    refs.lib.list.appendChild(empty);
    return;
  }
  for (const a of items) refs.lib.list.appendChild(renderLibItem(a, refs));
}

function renderLibItem(a: LibraryAsset, refs: UiRefs): HTMLElement {
  const item = el('div', 'sg-set-item');
  const img = new Image(40, 40);
  img.src = URL.createObjectURL(a.blob);
  item.appendChild(img);

  const body = el('div', 'sg-set-item-body');
  const prompt = el('div', 'sg-set-item-prompt', a.prompt);
  body.appendChild(prompt);

  const meta = el('div', 'sg-set-item-meta');
  const badge = el('span', `sg-set-badge ${a.curated}`, a.curated);
  meta.appendChild(badge);
  meta.append(`${a.kind} · ${a.width}×${a.height}${a.tags.length ? ' · ' + a.tags.join(', ') : ''}`);
  body.appendChild(meta);
  item.appendChild(body);

  const actions = el('div', 'sg-set-item-actions');
  const keep = el('button', 'sg-set-mini keep', 'Keep') as HTMLButtonElement;
  const rej  = el('button', 'sg-set-mini rej',  'Reject') as HTMLButtonElement;
  keep.addEventListener('click', async () => {
    await markAssetKept(a.key);
    await refreshLibList(refs);
  });
  rej.addEventListener('click', async () => {
    await markAssetRejected(a.key);
    await refreshLibList(refs);
  });
  actions.append(keep, rej);
  item.appendChild(actions);
  return item;
}
```

Wire `libGen` to the handler. Inside `createSettingsPanel`, after the existing `input.addEventListener('keydown', …)` line (around line 179), add:

```ts
  libGen.addEventListener('click', () => onLibGenerate(refs));
```

Then replace the existing `show()` function so the library list refreshes whenever the panel opens:

```ts
  function show(): void {
    overlay.style.display = '';
    setTimeout(() => input.focus(), 0);
    void refreshLibList(refs);
  }
```

- [ ] **Step 7: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -v 'tests/e2e/' | head -30`
Expected: no errors outside `tests/e2e/`. If you see "X is declared but its value is never read," delete the unused import or local.

- [ ] **Step 8: Run the full unit-test suite**

Run: `npm test 2>&1 | tail -20`
Expected: all tests pass (existing 464 + new library tests = ~490 ± a few). No tests are *removed* by this work.

- [ ] **Step 9: Manual browser verification**

Run: `npm run dev`
Then in the browser:
1. Open `http://localhost:3000`.
2. Press K (or click ⚙) to open the settings panel.
3. Confirm a Library section appears below the existing Test-generate area, with Prompt, Size, Kind, Tags, Description, Origin toggle, Generate button, Recent entries list.
4. With a saved PixelLab key, click Generate to library. After ~30-60s (free tier), an entry should appear in Recent entries with a `pending` badge and a thumbnail.
5. Click Keep on the new entry. Badge should flip to `kept`.
6. Click Generate again with the same prompt but origin=official. The entry should hit cache (~50ms), appear as `kept` (promoted), and the metadata should reflect the official-origin values.
7. Click Reject on an entry. Badge flips to `rejected`.
8. Close and reopen the panel — list should re-populate.

Report exactly what you saw. If anything misbehaves, **fix it before committing**.

- [ ] **Step 10: Commit**

```bash
git add src/services/pixellab.ts src/ui/settings-panel.ts tests/unit/pixellab.test.ts
git commit -m "feat(pixellab): library section in settings panel (generate-with-metadata + curation)"
```

---

## Task 9: Final verification + housekeeping

**Files:** none (verification only)

- [ ] **Step 1: Full type-check**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -v 'tests/e2e/' | wc -l`
Expected: `0` (no errors outside `tests/e2e/`).

- [ ] **Step 2: Full test suite**

Run: `npm test 2>&1 | tail -10`
Expected: all tests pass.

- [ ] **Step 3: Confirm commit log**

Run: `git log --oneline main..HEAD 2>/dev/null || git log --oneline -10`
Expected: 8 new commits in order: types → normalizeTags → schema v2 → generate metadata → findAssets → getAssetBlob → curation actions → settings panel.

- [ ] **Step 4: Push**

Run: `git push origin main`

---

## Coverage check (spec → tasks)

- **Data model (`LibraryAsset`, `AssetKind`, `CurationStatus`, `AssetOrigin`, `AssetQuery`, `AssetSummary`)** → Task 1
- **Indexes (`kind`, `curated`, `tags` multi-entry)** → Task 3
- **Migration v1 → v2 with safe defaults** → Task 3
- **`generate()` writes metadata; sandbox vs official curation** → Task 4
- **Cache-hit promotion sandbox → official** → Task 4
- **`findAssets({kind, tagsAll?, tagsAny?, size?, limit?})` returning only kept, newest-first** → Task 5
- **`getAssetBlob(id)`** → Task 6
- **`markAssetKept`, `markAssetRejected`, `updateAssetMetadata`, `normalizeTags`** → Tasks 2, 7
- **Population path = settings panel library section** → Task 8 (with supporting `listRecentAssets`)
- **No in-game consumer / agent stub / export-import this session** → enforced by scope

All spec requirements traced to tasks. Out-of-scope items deferred deliberately.
