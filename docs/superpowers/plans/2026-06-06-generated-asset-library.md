# Generated Asset Library (Slice 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a vendored, metadata-rich **base asset library** plus a unified cache-or-generate **AssetLibrary** facade, and wire **props + decorations (incl. isometric)** to it, so the game shows generated pixel-art sprites with no API key and grows the library during development.

**Architecture:** Two stores behind one facade — a git-tracked base library (`public/asset-library/manifest.ndjson` + `blobs/`) loaded at boot, and the existing per-user IndexedDB cache. A pure `asset-match` module filters/scores candidates from both sources uniformly. A render-only `art-resolver` binds entities to assets deterministically (never mutates the sim). A dev-only Vite plugin promotes live assets into the repo.

**Tech Stack:** TypeScript ES modules, Vite, Vitest + fake-indexeddb, Canvas2D (topdown + iso renderers), PixelLab API (`src/services/pixellab.ts`).

**Spec:** `docs/superpowers/specs/2026-06-06-generated-asset-library-design.md`

---

## File Structure

**Create:**
- `src/services/asset-match.ts` — pure predicate + scorer over asset metadata (shared by live + base).
- `src/services/base-library-loader.ts` — fetch + parse `manifest.ndjson`, resolve blob URLs.
- `src/services/asset-library.ts` — `AssetLibrary` facade: unified base-first query/pick/acquire/resolveBlob.
- `src/render/art-resolver.ts` — deterministic `(entity, style) → assetId | null`.
- `vite-plugins/promote-asset.ts` — dev-only write endpoint for promotion.
- `scripts/seed-base-library.mjs` — copy already-generated PNGs into the base library with manifest lines.
- `public/asset-library/manifest.ndjson` — base library manifest (starts with seeded entries).
- `public/asset-library/blobs/` — base library blob files.
- Test files mirroring each module under `tests/unit/`.

**Modify:**
- `src/core/types.ts` — schema v3 fields on `LibraryAsset`/`AssetQuery`/`AssetSummary`/`PixelLabGenerateOpts`; new `AssetStyle`/`AssetProvider`/`AssetAffinity`; extend `RenderContext`.
- `src/services/pixellab.ts` — `DB_VERSION = 3` + migration; write new fields in `generate()`; add `listKeptSummaries()`; route `passesFilters` through `asset-match`.
- `src/render/decoration-image-cache.ts` → generalize into an injectable-resolver cache (rename to `ArtImageCache`).
- `src/game/render-context.ts` — provide `resolveEntityArt` + the generalized art cache.
- `src/game/bootstrap-world.ts` — load base library at boot; build `AssetLibrary`.
- `src/render/renderer.ts` — topdown: resolve entity art before the fallback shape.
- `src/render/iso/iso-renderer.ts` (+ `iso-sprites.ts`) — draw decorations in iso; resolve prop art.
- `vite.config.ts` — register the dev-only promote plugin.
- `src/ui/settings-unified.ts` — "Generate & promote to base" dev action.

---

## Task 1: Schema v3 — types

**Files:**
- Modify: `src/core/types.ts:457-545`

- [ ] **Step 1: Add new metadata types + extend interfaces**

In `src/core/types.ts`, immediately after the `AssetOrigin` definition (line 468), add:

```ts
export type AssetStyle = 'pixel-art' | 'painterly' | 'unknown';
export type AssetProvider = 'pixellab' | 'replicate' | 'fal' | 'mock';

/** Soft selection hints — overlap raises an asset's match score, never required. */
export interface AssetAffinity {
  biome?: string[];
  era?: string[];
}
```

Change `LibraryAsset` (currently `schemaVersion: 2`, lines 500-517) to:

```ts
export interface LibraryAsset {
  key: string;
  schemaVersion: 3;

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

  // v3 metadata
  provider: AssetProvider;
  model: string;
  style: AssetStyle;
  recipeVersion: string;
  affinity?: AssetAffinity;
}
```

Extend `AssetQuery` (lines 520-530) — add after `size?`:

```ts
  /** Exact style match (e.g. only 'pixel-art'). */
  style?: AssetStyle;
  /** Exact model match — "only assets from this model". */
  model?: string;
  /** Exact provider match. */
  provider?: AssetProvider;
  /** OR-match biome affinity. */
  biomeAny?: string[];
  /** OR-match era affinity. */
  eraAny?: string[];
```

Extend `AssetSummary` (lines 534-545) — add after `description?`:

```ts
  style: AssetStyle;
  model: string;
  provider: AssetProvider;
  affinity?: AssetAffinity;
```

Extend `PixelLabGenerateOpts` (lines 472-489) — add after `origin?`:

```ts
  /** Style tag for the generated asset (defaults to 'pixel-art'). */
  style?: AssetStyle;
  /** Soft selection hints stored with the asset. */
  affinity?: AssetAffinity;
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: errors ONLY in `src/services/pixellab.ts` (LibraryAsset construction now missing new required fields). That's fixed in Task 2. No other files should error.

- [ ] **Step 3: Commit**

```bash
git add src/core/types.ts
git commit -m "feat(types): asset library schema v3 — provider/model/style/recipe/affinity"
```

---

## Task 2: Schema v3 — pixellab migration + write path + listKeptSummaries

**Files:**
- Modify: `src/services/pixellab.ts`
- Test: `tests/unit/pixellab-schema-v3.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/pixellab-schema-v3.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import {
  generate, cacheGet, listKeptSummaries, _resetDbForTesting,
} from '@/services/pixellab';

// PixelLab API + palette fetch are stubbed; we only exercise the cache write path.
beforeEach(async () => {
  _resetDbForTesting();
  await new Promise<void>((res) => {
    const req = indexedDB.deleteDatabase('smallgods.pixellab');
    req.onsuccess = req.onerror = () => res();
  });
  vi.restoreAllMocks();
  // Stub palette fetch + generation response.
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url).includes('palette')) {
      return { ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer } as any;
    }
    return { ok: true, json: async () => ({ image: { base64: btoa('PNGDATA') } }) } as any;
  }));
  // URL.createObjectURL is unused here but guard anyway.
  if (!('createObjectURL' in URL)) (URL as any).createObjectURL = () => 'blob:x';
});

describe('schema v3 write path', () => {
  it('generate() stamps provider/model/style/recipeVersion', async () => {
    const { key } = await generate('test-key', {
      prompt: 'a mossy boulder', width: 64, height: 64,
      kind: 'decoration', origin: 'official', tags: ['boulder'],
      style: 'pixel-art', affinity: { biome: ['grassland'] },
    });
    const rec = await cacheGet(key);
    expect(rec?.schemaVersion).toBe(3);
    expect(rec?.provider).toBe('pixellab');
    expect(rec?.model).toBe('pixflux');
    expect(rec?.style).toBe('pixel-art');
    expect(rec?.affinity).toEqual({ biome: ['grassland'] });
    expect(rec?.recipeVersion).toBeTruthy();
  });

  it('listKeptSummaries returns kept assets of a kind with v3 metadata', async () => {
    await generate('k', {
      prompt: 'a stump', width: 64, height: 64,
      kind: 'decoration', origin: 'official', style: 'pixel-art',
    });
    const out = await listKeptSummaries('decoration');
    expect(out).toHaveLength(1);
    expect(out[0].style).toBe('pixel-art');
    expect(out[0].provider).toBe('pixellab');
    expect(out[0].model).toBe('pixflux');
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/unit/pixellab-schema-v3.test.ts`
Expected: FAIL — `listKeptSummaries` is not exported; generated record lacks v3 fields.

- [ ] **Step 3: Implement migration + write path + listKeptSummaries**

In `src/services/pixellab.ts`:

(a) Bump version (line 18): `const DB_VERSION = 3;`

(b) In `openDb`'s `onupgradeneeded`, after the existing `if (oldVersion < 2)` block, add a v2→v3 backfill:

```ts
      // v2 → v3: backfill generation metadata
      if (oldVersion < 3) {
        const cur3 = store.openCursor();
        cur3.onsuccess = () => {
          const cursor = cur3.result;
          if (!cursor) return;
          const v = cursor.value as Record<string, unknown>;
          if (v.schemaVersion !== 3) {
            cursor.update({
              ...v,
              schemaVersion: 3,
              provider: v.provider ?? 'pixellab',
              model: v.model ?? 'pixflux',
              style: v.style ?? 'pixel-art',
              recipeVersion: v.recipeVersion ?? RECIPE_V,
            });
          }
          cursor.continue();
        };
        if (!store.indexNames.contains('style')) store.createIndex('style', 'style');
      }
```

(c) In `generate()`, where the `asset: LibraryAsset` object is built (around line 314), add the new fields:

```ts
  const asset: LibraryAsset = {
    key,
    schemaVersion: 3,
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
    provider: 'pixellab',
    model: 'pixflux',
    style: opts.style ?? 'pixel-art',
    recipeVersion: RECIPE_V,
    affinity: opts.affinity,
  };
```

(d) In `toSummary()` (around line 372) add the new fields:

```ts
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
  };
}
```

(e) In the promotion branch inside `generate()` (the `origin === 'official' && hit.curated !== 'kept'` block, ~line 282), also carry style/affinity so a promoted sandbox asset gains them:

```ts
      const promoted: LibraryAsset = {
        ...hit,
        curated: 'kept',
        origin: 'official',
        kind: opts.kind ?? hit.kind,
        tags: opts.tags ? normalizeTags(opts.tags) : hit.tags,
        description: opts.description ?? hit.description,
        style: opts.style ?? hit.style ?? 'pixel-art',
        affinity: opts.affinity ?? hit.affinity,
      };
```

(f) Add a new export after `findAssets` (after line 383):

```ts
/** All kept assets of a kind, newest-first, with full v3 metadata. Unlike
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
  });
}
```

Add `AssetKind` to the type import at the top of the file if not present.

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/unit/pixellab-schema-v3.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the existing pixellab tests for regressions**

Run: `npx vitest run tests/unit/pixellab`
Expected: PASS (existing suites green; migration is additive).

- [ ] **Step 6: Commit**

```bash
git add src/services/pixellab.ts tests/unit/pixellab-schema-v3.test.ts
git commit -m "feat(pixellab): schema v3 migration + metadata write path + listKeptSummaries"
```

---

## Task 3: asset-match — pure predicate + scorer

**Files:**
- Create: `src/services/asset-match.ts`
- Test: `tests/unit/asset-match.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/asset-match.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { matchesAsset, scoreAsset, type AssetMeta, type AssetRequest } from '@/services/asset-match';

const base: AssetMeta = {
  kind: 'decoration', style: 'pixel-art', model: 'pixflux', provider: 'pixellab',
  tags: ['boulder', 'mossy'], affinity: { biome: ['grassland'], era: ['ancient'] },
  width: 64, height: 64,
};

describe('matchesAsset (hard filters)', () => {
  it('requires kind + style', () => {
    expect(matchesAsset(base, { kind: 'decoration', style: 'pixel-art' })).toBe(true);
    expect(matchesAsset(base, { kind: 'building', style: 'pixel-art' })).toBe(false);
    expect(matchesAsset(base, { kind: 'decoration', style: 'painterly' })).toBe(false);
  });
  it('honors optional model/provider hard filters', () => {
    expect(matchesAsset(base, { kind: 'decoration', style: 'pixel-art', model: 'pixflux' })).toBe(true);
    expect(matchesAsset(base, { kind: 'decoration', style: 'pixel-art', model: 'other' })).toBe(false);
  });
  it('honors size when given', () => {
    expect(matchesAsset(base, { kind: 'decoration', style: 'pixel-art', size: { w: 64, h: 64 } })).toBe(true);
    expect(matchesAsset(base, { kind: 'decoration', style: 'pixel-art', size: { w: 32, h: 32 } })).toBe(false);
  });
});

describe('scoreAsset (soft)', () => {
  it('rewards tag and affinity overlap', () => {
    const req: AssetRequest = {
      kind: 'decoration', style: 'pixel-art',
      tagsAny: ['boulder'], biomeAny: ['grassland'], eraAny: ['ancient'],
    };
    const lean: AssetRequest = { kind: 'decoration', style: 'pixel-art' };
    expect(scoreAsset(base, req)).toBeGreaterThan(scoreAsset(base, lean));
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/unit/asset-match.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/services/asset-match.ts`:

```ts
import type { AssetKind, AssetStyle, AssetProvider, AssetAffinity } from '@/core/types';

/** The common metadata shape both base records and live summaries expose. */
export interface AssetMeta {
  kind: AssetKind;
  style: AssetStyle;
  model: string;
  provider: AssetProvider;
  tags: string[];
  affinity?: AssetAffinity;
  width: number;
  height: number;
}

export interface AssetRequest {
  kind: AssetKind;
  style: AssetStyle;
  model?: string;
  provider?: AssetProvider;
  tagsAny?: string[];
  biomeAny?: string[];
  eraAny?: string[];
  size?: { w: number; h: number };
}

/** Hard filters — all must pass for an asset to be a candidate. */
export function matchesAsset(a: AssetMeta, req: AssetRequest): boolean {
  if (a.kind !== req.kind) return false;
  if (a.style !== req.style) return false;
  if (req.model && a.model !== req.model) return false;
  if (req.provider && a.provider !== req.provider) return false;
  if (req.size && (a.width !== req.size.w || a.height !== req.size.h)) return false;
  return true;
}

function overlap(have: string[] | undefined, want: string[] | undefined): number {
  if (!have || !want) return 0;
  const set = new Set(have);
  let n = 0;
  for (const w of want) if (set.has(w)) n++;
  return n;
}

/** Soft score — higher is a better fit. Assumes matchesAsset already passed. */
export function scoreAsset(a: AssetMeta, req: AssetRequest): number {
  let s = 0;
  s += overlap(a.tags, req.tagsAny) * 3;
  s += overlap(a.affinity?.biome, req.biomeAny) * 2;
  s += overlap(a.affinity?.era, req.eraAny) * 2;
  return s;
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/unit/asset-match.test.ts`
Expected: PASS.

- [ ] **Step 5: Route pixellab's passesFilters through it (no behavior change)**

In `src/services/pixellab.ts`, replace the body of `passesFilters` (lines 364-370) so the live query honors the new optional filters too:

```ts
import { matchesAsset } from './asset-match';

function passesFilters(a: LibraryAsset, q: AssetQuery): boolean {
  if (a.curated !== 'kept') return false;
  if (!matchesAsset(
    { kind: a.kind, style: a.style ?? 'pixel-art', model: a.model ?? 'pixflux',
      provider: a.provider ?? 'pixellab', tags: a.tags, affinity: a.affinity,
      width: a.width, height: a.height },
    { kind: q.kind, style: q.style ?? (a.style ?? 'pixel-art'),
      model: q.model, provider: q.provider, size: q.size },
  )) return false;
  // tagsAll / tagsAny preserved from the original behavior
  if (q.tagsAll && !q.tagsAll.every(t => a.tags.includes(t))) return false;
  if (q.tagsAny && !q.tagsAny.some(t => a.tags.includes(t))) return false;
  return true;
}
```

Note: `style` defaults to the asset's own style when the query omits it, so existing `findAssets({ kind })` calls (the decoration modal) keep returning everything of that kind.

- [ ] **Step 6: Run pixellab tests for regressions**

Run: `npx vitest run tests/unit/pixellab tests/unit/asset-match.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/services/asset-match.ts tests/unit/asset-match.test.ts src/services/pixellab.ts
git commit -m "feat(assets): pure asset-match predicate+scorer; route live query through it"
```

---

## Task 4: base-library-loader — parse manifest + resolve URLs

**Files:**
- Create: `src/services/base-library-loader.ts`
- Test: `tests/unit/base-library-loader.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/base-library-loader.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseManifest, baseBlobUrl, type BaseLibraryRecord } from '@/services/base-library-loader';

const valid = JSON.stringify({
  key: 'a1', kind: 'decoration', style: 'pixel-art', provider: 'pixellab', model: 'pixflux',
  recipeVersion: 'v1', prompt: 'a bush', width: 64, height: 64, tags: ['bush'],
  affinity: { biome: ['grassland'] }, blob: 'blobs/decoration-a1.png', generatedAt: 1,
});

describe('parseManifest', () => {
  it('parses valid NDJSON lines', () => {
    const recs = parseManifest(valid + '\n');
    expect(recs).toHaveLength(1);
    expect(recs[0].key).toBe('a1');
    expect(recs[0].tags).toEqual(['bush']);
  });
  it('skips blank and malformed lines without throwing', () => {
    const recs = parseManifest(`${valid}\n\nnot-json\n{"missing":"fields"}\n`);
    expect(recs).toHaveLength(1); // only the fully-valid record
    expect(recs[0].key).toBe('a1');
  });
});

describe('baseBlobUrl', () => {
  it('joins the library path with the relative blob path', () => {
    const rec = { blob: 'blobs/decoration-a1.png' } as BaseLibraryRecord;
    // BASE_URL is '/' in tests, so the URL is rooted there.
    expect(baseBlobUrl(rec)).toBe('/asset-library/blobs/decoration-a1.png');
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/unit/base-library-loader.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/services/base-library-loader.ts`:

```ts
import type { AssetKind, AssetStyle, AssetProvider, AssetAffinity } from '@/core/types';
import { assetUrl } from '@/core/asset-url';

const MANIFEST_PATH = 'asset-library/manifest.ndjson';

/** One base-library entry. Mirrors LibraryAsset minus the Blob (a file instead). */
export interface BaseLibraryRecord {
  key: string;
  kind: AssetKind;
  style: AssetStyle;
  provider: AssetProvider;
  model: string;
  recipeVersion: string;
  prompt: string;
  width: number;
  height: number;
  tags: string[];
  affinity?: AssetAffinity;
  /** Path relative to public/asset-library/, e.g. "blobs/decoration-a1.png". */
  blob: string;
  generatedAt: number;
  description?: string;
}

const REQUIRED: (keyof BaseLibraryRecord)[] = [
  'key', 'kind', 'style', 'provider', 'model', 'recipeVersion',
  'prompt', 'width', 'height', 'tags', 'blob', 'generatedAt',
];

function isValid(o: unknown): o is BaseLibraryRecord {
  if (!o || typeof o !== 'object') return false;
  const r = o as Record<string, unknown>;
  return REQUIRED.every(k => r[k] !== undefined && r[k] !== null);
}

/** Parse NDJSON text into records. Blank/malformed/incomplete lines are skipped
 *  (a dev warning is logged) so one bad line never breaks the whole library. */
export function parseManifest(text: string): BaseLibraryRecord[] {
  const out: BaseLibraryRecord[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    try {
      const obj = JSON.parse(line);
      if (isValid(obj)) out.push(obj);
      else console.warn('[base-library] skipping incomplete manifest line:', line.slice(0, 80));
    } catch {
      console.warn('[base-library] skipping malformed manifest line:', line.slice(0, 80));
    }
  }
  return out;
}

/** Absolute URL for a record's blob file, subpath-safe (GitHub Pages). */
export function baseBlobUrl(rec: BaseLibraryRecord): string {
  return assetUrl(`asset-library/${rec.blob}`);
}

/** Fetch + parse the manifest at boot. Returns [] if absent/unreadable. */
export async function loadBaseLibrary(
  fetchImpl: typeof fetch = fetch,
): Promise<BaseLibraryRecord[]> {
  try {
    const res = await fetchImpl(assetUrl(MANIFEST_PATH));
    if (!res.ok) return [];
    return parseManifest(await res.text());
  } catch {
    return [];
  }
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/unit/base-library-loader.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/base-library-loader.ts tests/unit/base-library-loader.test.ts
git commit -m "feat(assets): base-library-loader — parse NDJSON manifest, resolve blob URLs"
```

---

## Task 5: AssetLibrary facade — unified query/pick/resolveBlob

**Files:**
- Create: `src/services/asset-library.ts`
- Test: `tests/unit/asset-library.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/asset-library.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { AssetLibrary } from '@/services/asset-library';
import type { BaseLibraryRecord } from '@/services/base-library-loader';
import type { AssetSummary } from '@/core/types';

const baseRec: BaseLibraryRecord = {
  key: 'base1', kind: 'decoration', style: 'pixel-art', provider: 'pixellab', model: 'pixflux',
  recipeVersion: 'v1', prompt: 'a base bush', width: 64, height: 64, tags: ['bush'],
  affinity: { biome: ['grassland'] }, blob: 'blobs/decoration-base1.png', generatedAt: 1,
};

function summary(over: Partial<AssetSummary>): AssetSummary {
  return {
    id: 'live1', kind: 'decoration', tags: ['bush'], prompt: 'a live bush',
    width: 64, height: 64, addedAt: 2, style: 'pixel-art', model: 'pixflux',
    provider: 'pixellab', ...over,
  };
}

describe('AssetLibrary.query', () => {
  it('merges base + live, base wins on duplicate key, applies hard filters', async () => {
    const live = vi.fn(async () => [summary({ id: 'live1' }), summary({ id: 'base1' })]);
    const lib = new AssetLibrary([baseRec], { listKeptSummaries: live });
    const res = await lib.query({ kind: 'decoration', style: 'pixel-art' });
    const ids = res.map(r => r.id).sort();
    expect(ids).toEqual(['base1', 'live1']); // base1 de-duped to the base record
    expect(res.find(r => r.id === 'base1')!.sourceTier).toBe('base');
    expect(res.find(r => r.id === 'live1')!.sourceTier).toBe('live');
  });

  it('filters out the wrong kind/style', async () => {
    const live = vi.fn(async () => [summary({ id: 'live1', style: 'painterly' })]);
    const lib = new AssetLibrary([baseRec], { listKeptSummaries: live });
    const res = await lib.query({ kind: 'decoration', style: 'pixel-art' });
    expect(res.map(r => r.id)).toEqual(['base1']);
  });
});

describe('AssetLibrary.pick', () => {
  it('is deterministic for the same seed and varies candidates by seed', async () => {
    const recs: BaseLibraryRecord[] = [
      { ...baseRec, key: 'b1' }, { ...baseRec, key: 'b2' }, { ...baseRec, key: 'b3' },
    ];
    const lib = new AssetLibrary(recs, { listKeptSummaries: async () => [] });
    const a = await lib.pick({ kind: 'decoration', style: 'pixel-art', seed: 5 });
    const b = await lib.pick({ kind: 'decoration', style: 'pixel-art', seed: 5 });
    expect(a!.id).toBe(b!.id); // stable
  });

  it('returns null when nothing matches', async () => {
    const lib = new AssetLibrary([], { listKeptSummaries: async () => [] });
    expect(await lib.pick({ kind: 'building', style: 'pixel-art' })).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/unit/asset-library.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/services/asset-library.ts`:

```ts
import type { AssetKind, AssetSummary } from '@/core/types';
import {
  matchesAsset, scoreAsset, type AssetMeta, type AssetRequest as MatchRequest,
} from './asset-match';
import { type BaseLibraryRecord, baseBlobUrl } from './base-library-loader';
import { listKeptSummaries as defaultListKept, getAssetBlob } from './pixellab';

export interface AssetRequest extends MatchRequest {
  /** Deterministic tie-break among equally-scored candidates. */
  seed?: number;
}

export interface ResolvedAsset {
  id: string;
  sourceTier: 'base' | 'live';
  width: number;
  height: number;
  score: number;
}

/** Injection seam so tests can supply a fake live source. */
export interface AssetLibraryDeps {
  listKeptSummaries: (kind: AssetKind) => Promise<AssetSummary[]>;
}

function baseToMeta(r: BaseLibraryRecord): AssetMeta {
  return {
    kind: r.kind, style: r.style, model: r.model, provider: r.provider,
    tags: r.tags, affinity: r.affinity, width: r.width, height: r.height,
  };
}
function summaryToMeta(s: AssetSummary): AssetMeta {
  return {
    kind: s.kind, style: s.style, model: s.model, provider: s.provider,
    tags: s.tags, affinity: s.affinity, width: s.width, height: s.height,
  };
}

/** Tiny deterministic string hash (FNV-1a) → non-negative int. */
function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

export class AssetLibrary {
  private readonly baseByKey = new Map<string, BaseLibraryRecord>();
  private readonly listKept: AssetLibraryDeps['listKeptSummaries'];

  constructor(base: BaseLibraryRecord[], deps?: Partial<AssetLibraryDeps>) {
    for (const r of base) this.baseByKey.set(r.key, r);
    this.listKept = deps?.listKeptSummaries ?? defaultListKept;
  }

  /** All matching assets, scored desc, base-first on ties; base wins duplicate keys. */
  async query(req: AssetRequest): Promise<ResolvedAsset[]> {
    const out: ResolvedAsset[] = [];

    for (const r of this.baseByKey.values()) {
      const meta = baseToMeta(r);
      if (matchesAsset(meta, req)) {
        out.push({ id: r.key, sourceTier: 'base', width: r.width, height: r.height, score: scoreAsset(meta, req) });
      }
    }

    const live = await this.listKept(req.kind);
    for (const s of live) {
      if (this.baseByKey.has(s.id)) continue; // base wins duplicate key
      const meta = summaryToMeta(s);
      if (matchesAsset(meta, req)) {
        out.push({ id: s.id, sourceTier: 'live', width: s.width, height: s.height, score: scoreAsset(meta, req) });
      }
    }

    out.sort((a, b) =>
      b.score - a.score ||
      (a.sourceTier === b.sourceTier ? 0 : a.sourceTier === 'base' ? -1 : 1) ||
      (a.id < b.id ? -1 : 1));
    return out;
  }

  /** Deterministic single pick: top score, ties broken by seed hash. */
  async pick(req: AssetRequest): Promise<ResolvedAsset | null> {
    const all = await this.query(req);
    if (all.length === 0) return null;
    const top = all.filter(a => a.score === all[0].score);
    if (top.length === 1) return top[0];
    const idx = hashStr(`${req.seed ?? 0}`) % top.length;
    return top[idx];
  }

  /** Resolve any asset id to a Blob: base → fetch file, else → IndexedDB. */
  async resolveBlob(id: string): Promise<Blob | null> {
    const baseRec = this.baseByKey.get(id);
    if (baseRec) {
      try {
        const res = await fetch(baseBlobUrl(baseRec));
        return res.ok ? await res.blob() : null;
      } catch { return null; }
    }
    return getAssetBlob(id);
  }
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/unit/asset-library.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/asset-library.ts tests/unit/asset-library.test.ts
git commit -m "feat(assets): AssetLibrary facade — base-first merge, deterministic pick, resolveBlob"
```

---

## Task 6: art-resolver — entity → assetId (render-only, deterministic)

**Files:**
- Create: `src/render/art-resolver.ts`
- Test: `tests/unit/art-resolver.test.ts`

The resolver maps an entity to an `assetId` for rendering. It folds the entity's fine-grained `kind` into the request as a tag, with `AssetKind: 'decoration'` as the coarse category (per spec resolution: props live under `'decoration'` + tags). It memoizes per entity id and **never mutates the entity**.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/art-resolver.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { ArtResolver } from '@/render/art-resolver';
import type { AssetLibrary, ResolvedAsset } from '@/services/asset-library';
import type { Entity } from '@/core/types';

function fakeLib(pickResult: ResolvedAsset | null) {
  return { pick: vi.fn(async () => pickResult) } as unknown as AssetLibrary;
}
function ent(id: string, kind: string): Entity {
  return { id, kind, x: 1, y: 1, tags: [], properties: {} } as unknown as Entity;
}

describe('ArtResolver', () => {
  it('returns the picked id and memoizes per entity id (one pick call)', async () => {
    const lib = fakeLib({ id: 'asset-x', sourceTier: 'base', width: 64, height: 64, score: 0 });
    const r = new ArtResolver(lib, 'pixel-art');
    const e = ent('boulder#1', 'boulder');
    expect(await r.resolve(e)).toBe('asset-x');
    expect(await r.resolve(e)).toBe('asset-x');
    expect((lib.pick as any)).toHaveBeenCalledTimes(1); // memoized
  });

  it('passes entity kind as a tag + decoration AssetKind, seeded by entity id', async () => {
    const lib = fakeLib(null);
    const r = new ArtResolver(lib, 'pixel-art');
    await r.resolve(ent('boulder#7', 'boulder'));
    const req = (lib.pick as any).mock.calls[0][0];
    expect(req.kind).toBe('decoration');
    expect(req.style).toBe('pixel-art');
    expect(req.tagsAny).toContain('boulder');
    expect(typeof req.seed).toBe('number');
  });

  it('caches null misses too (no repeated pick)', async () => {
    const lib = fakeLib(null);
    const r = new ArtResolver(lib, 'pixel-art');
    const e = ent('rock#2', 'rock');
    expect(await r.resolve(e)).toBeNull();
    expect(await r.resolve(e)).toBeNull();
    expect((lib.pick as any)).toHaveBeenCalledTimes(1);
  });

  it('does not mutate the entity', async () => {
    const lib = fakeLib({ id: 'a', sourceTier: 'base', width: 64, height: 64, score: 0 });
    const r = new ArtResolver(lib, 'pixel-art');
    const e = ent('x#1', 'x');
    const snapshot = JSON.stringify(e);
    await r.resolve(e);
    expect(JSON.stringify(e)).toBe(snapshot);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/unit/art-resolver.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/render/art-resolver.ts`:

```ts
import type { AssetStyle, Entity } from '@/core/types';
import type { AssetLibrary } from '@/services/asset-library';

/** FNV-1a hash → non-negative int. Mirrors AssetLibrary's tie-break hash. */
function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/**
 * Binds world entities to library art for rendering. Render-only: it reads the
 * entity and returns an assetId (or null) without ever writing back, so the sim
 * and replay are untouched. Deterministic + memoized per entity id.
 */
export class ArtResolver {
  private readonly cache = new Map<string, string | null>();

  constructor(private readonly lib: AssetLibrary, private readonly style: AssetStyle) {}

  /** Returns an assetId for the entity, or null if the library has no match. */
  async resolve(e: Entity): Promise<string | null> {
    const cached = this.cache.get(e.id);
    if (cached !== undefined) return cached;
    const picked = await this.lib.pick({
      kind: 'decoration',
      style: this.style,
      tagsAny: [e.kind],
      seed: hashStr(e.id),
    });
    const id = picked?.id ?? null;
    this.cache.set(e.id, id);
    return id;
  }

  /** Synchronous read of an already-resolved id (null if not resolved or miss). */
  peek(e: Entity): string | null {
    return this.cache.get(e.id) ?? null;
  }

  /** Kick resolution without awaiting (fire-and-forget for the render loop). */
  warm(e: Entity): void { void this.resolve(e); }

  /** Clear on world reset. */
  clear(): void { this.cache.clear(); }
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/unit/art-resolver.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/render/art-resolver.ts tests/unit/art-resolver.test.ts
git commit -m "feat(render): ArtResolver — deterministic, memoized, render-only entity→assetId"
```

---

## Task 7: Generalize DecorationImageCache → ArtImageCache (injectable resolver)

The render loop needs a synchronous image accessor that loads blobs from **either** the base library (file) **or** IndexedDB. Today `DecorationImageCache` hardcodes `getAssetBlob` (IndexedDB only). Generalize it to take a blob resolver, then back it with `AssetLibrary.resolveBlob`.

**Files:**
- Modify: `src/render/decoration-image-cache.ts` (rename class, inject resolver)
- Modify: `src/game/bootstrap-world.ts`, `src/game/render-context.ts`, `src/game.ts` (construction site)
- Test: `tests/unit/art-image-cache.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/art-image-cache.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ArtImageCache } from '@/render/decoration-image-cache';

beforeEach(() => {
  (URL as any).createObjectURL = vi.fn(() => 'blob:fake');
  (URL as any).revokeObjectURL = vi.fn();
  // jsdom Image: mark complete so get() returns it after load.
});

describe('ArtImageCache', () => {
  it('uses the injected resolver to fetch blobs', async () => {
    const resolver = vi.fn(async (id: string) =>
      id === 'known' ? new Blob([new Uint8Array([1])], { type: 'image/png' }) : null);
    const cache = new ArtImageCache(resolver);
    const img = await cache.load('known');
    expect(resolver).toHaveBeenCalledWith('known');
    expect(img).not.toBeNull();
  });

  it('returns null for unknown ids and does not cache an Image', async () => {
    const resolver = vi.fn(async () => null);
    const cache = new ArtImageCache(resolver);
    expect(await cache.load('missing')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/unit/art-image-cache.test.ts`
Expected: FAIL — `ArtImageCache` not exported.

- [ ] **Step 3: Generalize the cache**

Rewrite `src/render/decoration-image-cache.ts`:

```ts
import { getAssetBlob } from '@/services/pixellab';

export type BlobResolver = (id: string) => Promise<Blob | null>;

/**
 * Holds `HTMLImageElement`s for asset ids, loaded lazily via an injected blob
 * resolver (base-library file OR IndexedDB). One instance per Game.
 *
 * `get(id)` returns null until the image is fully loaded so the renderer can
 * fall back to a placeholder during the first frame.
 */
export class ArtImageCache {
  private images = new Map<string, HTMLImageElement>();
  private urls = new Map<string, string>();
  private inFlight = new Set<string>();

  constructor(private readonly resolveBlob: BlobResolver = getAssetBlob) {}

  get(id: string): HTMLImageElement | null {
    const img = this.images.get(id);
    if (img && img.complete && img.naturalWidth > 0) return img;
    if (!this.images.has(id) && !this.inFlight.has(id)) void this.load(id);
    return null;
  }

  async load(id: string): Promise<HTMLImageElement | null> {
    const existing = this.images.get(id);
    if (existing) return existing;
    if (this.inFlight.has(id)) return null;
    this.inFlight.add(id);
    try {
      const blob = await this.resolveBlob(id);
      if (!blob) return null;
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.src = url;
      this.images.set(id, img);
      this.urls.set(id, url);
      return img;
    } finally {
      this.inFlight.delete(id);
    }
  }

  async preload(ids: Iterable<string>): Promise<void> {
    await Promise.all(Array.from(ids, id => this.load(id)));
  }

  destroy(): void {
    for (const url of this.urls.values()) URL.revokeObjectURL(url);
    this.urls.clear();
    this.images.clear();
    this.inFlight.clear();
  }
}

/** Back-compat alias — existing imports keep working until callers migrate. */
export { ArtImageCache as DecorationImageCache };
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/unit/art-image-cache.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck (alias keeps existing callers compiling)**

Run: `npx tsc --noEmit`
Expected: PASS — `DecorationImageCache` alias preserves `src/game/*` imports and the type-only import in `render-context.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/render/decoration-image-cache.ts tests/unit/art-image-cache.test.ts
git commit -m "refactor(render): generalize DecorationImageCache → ArtImageCache (injectable resolver)"
```

---

## Task 8: Boot wiring — load base library, build AssetLibrary + resolver, back the cache

**Files:**
- Modify: `src/game/bootstrap-world.ts`
- Modify: `src/game.ts` (own the AssetLibrary + ArtResolver; pass into render-context)
- Modify: `src/game/render-context.ts` + `src/core/types.ts` (RenderContext gains `resolveEntityArt`)

This task has no new unit test (it's integration glue); it is verified by `npm run build` + the existing suite + manual. Keep each edit minimal.

- [ ] **Step 1: Load the base library during bootstrap**

In `src/game/bootstrap-world.ts`, add an import:

```ts
import { loadBaseLibrary, type BaseLibraryRecord } from '@/services/base-library-loader';
```

Add `baseLibrary: BaseLibraryRecord[]` to the bootstrap deps/output (follow the file's existing return shape). In the two places `await assets.loadAll()` runs (lines 48, 70), load the base library alongside:

```ts
    const baseLibrary = await loadBaseLibrary();
```

and surface `baseLibrary` to the caller (`game.ts`) the same way `generatedDecorations` is surfaced (e.g. assign to `state` or return it — match the file's current convention).

- [ ] **Step 2: Construct AssetLibrary + ArtResolver in Game**

In `src/game.ts`, after the world/assets are set up and `baseLibrary` is available, add fields:

```ts
import { AssetLibrary } from '@/services/asset-library';
import { ArtResolver } from '@/render/art-resolver';
import { ArtImageCache } from '@/render/decoration-image-cache';
```

```ts
    this.assetLibrary = new AssetLibrary(baseLibrary);
    this.artResolver = new ArtResolver(this.assetLibrary, 'pixel-art');
    // Back the (renamed) image cache with the unified resolver so it can load
    // base-library files AND IndexedDB blobs.
    this.decorationImages = new ArtImageCache((id) => this.assetLibrary.resolveBlob(id));
```

(Replace the existing `new DecorationImageCache()` construction. The decoration preload in bootstrap still works because `resolveBlob` falls through to IndexedDB for non-base ids.)

- [ ] **Step 3: Add `resolveEntityArt` to RenderContext**

In `src/core/types.ts`, in `RenderContext` (after `resolveDecorationImage`, line 163), add:

```ts
  /** Resolves an entity to its cached art `<img>` (base library or live), or
   *  null while loading / on no match (renderer keeps its procedural fallback). */
  resolveEntityArt?: (entity: Entity) => HTMLImageElement | null;
```

In `src/game/render-context.ts`, extend `RenderContextDeps` with `artResolver: ArtResolver` and `assetLibrary`-backed `decorationImages` (already an `ArtImageCache`), then add to the returned object:

```ts
    resolveEntityArt: (entity) => {
      const id = deps.artResolver.peek(entity);
      if (id) return decorationImages.get(id);
      deps.artResolver.warm(entity); // fire-and-forget; no blocking in the frame
      return null;
    },
```

Add the necessary import: `import type { ArtResolver } from '@/render/art-resolver';` and `import type { Entity } from '@/core/types';`. Thread `artResolver` from `game.ts` into `buildRenderContext(...)` at its call site.

- [ ] **Step 4: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: PASS (no type errors; production bundle builds).

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS — no regressions (this task adds wiring, not behavior changes to existing paths).

- [ ] **Step 6: Commit**

```bash
git add src/game/bootstrap-world.ts src/game.ts src/game/render-context.ts src/core/types.ts
git commit -m "feat(render): wire AssetLibrary + ArtResolver into boot and RenderContext"
```

---

## Task 9: Topdown render — resolve entity art before the fallback shape

**Files:**
- Modify: `src/render/renderer.ts:413-424` (`drawEntity`)

Verified by build + manual (canvas drawing). The change inserts an art lookup just before the procedural fallback so props with a library asset render as sprites.

- [ ] **Step 1: Insert the art branch**

In `src/render/renderer.ts` `drawEntity`, replace the "4. Fallback shape" tail (lines 423-424) with:

```ts
  // 4. Resolved library art (props/nature seeded into the asset library).
  const artImg = rc.resolveEntityArt?.(e) ?? null;
  if (artImg) {
    const px = e.x * TILE_SIZE;
    const py = e.y * TILE_SIZE;
    // Anchor the (square) sprite bottom-center on the tile, like decorations.
    ctx.drawImage(artImg, px - TILE_SIZE / 2, py - TILE_SIZE, TILE_SIZE, TILE_SIZE);
    return;
  }

  // 5. Fallback shape
  drawEntityFallback(ctx, rc, e);
```

- [ ] **Step 2: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: PASS.

- [ ] **Step 3: Manual verification (deferred until Task 12 seeds assets)**

After Task 12, run `npm run dev`, switch to topdown (`?render=topdown`), and confirm a seeded prop kind draws its sprite instead of a colored shape. Note here; do not block the commit.

- [ ] **Step 4: Commit**

```bash
git add src/render/renderer.ts
git commit -m "feat(render): topdown draws resolved library art before procedural fallback"
```

---

## Task 10: Iso render — draw decorations + resolved prop art

**Files:**
- Modify: `src/render/iso/iso-renderer.ts:51-123`
- Modify: `src/render/iso/iso-sprites.ts` (add `drawIsoDecoration` / `drawIsoArtBillboard`)

The iso renderer currently ignores `generatedDecorations` entirely and draws vegetation/buildings/npcs only. Add a decoration pass and a resolved-art billboard for props. Verified by build + manual.

- [ ] **Step 1: Add an iso art-billboard helper**

In `src/render/iso/iso-sprites.ts`, add (mirroring the existing `drawIsoVegetation` billboard math — anchor bottom-center at the tile's screen position):

```ts
import { worldToScreen } from './iso-projection';
import { ISO_TILE_W } from './iso-constants';

/** Draw a square art sprite as an upright billboard anchored at a tile. */
export function drawIsoArtBillboard(
  drawCtx: { ctx: CanvasRenderingContext2D; originX: number; originY: number },
  img: HTMLImageElement,
  tx: number,
  ty: number,
): void {
  const { ctx, originX, originY } = drawCtx;
  const { sx, sy } = worldToScreen(tx, ty, 0, originX, originY);
  const w = ISO_TILE_W;
  const h = ISO_TILE_W; // square source
  ctx.drawImage(img, sx - w / 2, sy - h, w, h);
}
```

(If `worldToScreen`'s signature differs, match the call already used in `iso-sprites.ts`/`iso-building.ts`; the helper only needs the tile's screen anchor.)

- [ ] **Step 2: Draw decorations in the iso Y-sort**

In `src/render/iso/iso-renderer.ts`:

(a) After the npc entries loop (line 108), add decoration entries:

```ts
    const decoById = new Map<string, { tx: number; ty: number; assetId: string }>();
    if (rc.generatedDecorations && !isLayerHidden('vegetation', rc.devMode)) {
      for (const d of rc.generatedDecorations) {
        const id = `deco:${d.tileX},${d.tileY}`;
        decoById.set(id, { tx: d.tileX, ty: d.tileY, assetId: d.assetId });
        entries.push({
          id, kind: 'decoration',
          tx: d.tileX, ty: d.tileY, z: 0,
          kindPriority: KIND_PRIORITY.vegetation,
        });
      }
    }
```

Add `'decoration'` to the `YSortEntry` kind union and `KIND_PRIORITY` if those are closed types (check `iso-ysort.ts`; reuse the vegetation priority value if a new key is awkward).

(b) Extend `drawCtx` (line 110) to carry the resolvers:

```ts
    const drawCtx = {
      ctx, atlas: effectiveAtlas, originX, originY,
      npcSheets: rc.npcSheets, treeSheets: rc.treeSheets,
    };
```

(c) In the sorted dispatch loop (lines 112-123), add a decoration branch:

```ts
      } else if (e.kind === 'decoration') {
        const d = decoById.get(e.id);
        const img = d ? rc.resolveDecorationImage?.(d.assetId) ?? null : null;
        if (d && img) drawIsoArtBillboard(drawCtx, img, d.tx, d.ty);
      }
```

(d) In the vegetation branch, prefer resolved library art when present, else keep the existing `drawIsoVegetation`:

```ts
      } else if (e.kind === 'vegetation') {
        const v = vegById.get(e.id);
        if (v) {
          const art = rc.resolveEntityArt?.(v) ?? null;
          if (art) drawIsoArtBillboard(drawCtx, art, Math.floor(v.x), Math.floor(v.y));
          else drawIsoVegetation(drawCtx, v);
        }
      }
```

Import `drawIsoArtBillboard` from `./iso-sprites`.

- [ ] **Step 3: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: PASS.

- [ ] **Step 4: Manual verification (after Task 12)**

`npm run dev` (default iso), place a decoration via right-click → it now renders in iso (previously invisible). Note here; don't block commit.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/render/iso/iso-renderer.ts src/render/iso/iso-sprites.ts
git commit -m "feat(iso): draw decorations + resolved prop art in the iso Y-sort"
```

---

## Task 11: Vite dev plugin — promote a live asset into the repo

**Files:**
- Create: `vite-plugins/promote-asset.ts`
- Modify: `vite.config.ts`
- Test: `tests/unit/promote-manifest-line.test.ts` (the pure helper only)

The browser can't write `public/` at runtime; a dev-only Vite middleware accepts a POST and writes the blob + appends a manifest line. The pure manifest-line builder is unit-tested; the fs/middleware is dev-only and manually verified (and asserted absent from the prod build in Step 6).

- [ ] **Step 1: Write the failing test (pure helper)**

Create `tests/unit/promote-manifest-line.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildManifestLine, blobFileName } from '../../vite-plugins/promote-asset';

describe('promote helpers', () => {
  it('builds a stable blob filename from kind + key', () => {
    expect(blobFileName('decoration', 'a1b2')).toBe('decoration-a1b2.png');
  });
  it('builds a one-line JSON manifest record with a relative blob path', () => {
    const line = buildManifestLine({
      key: 'a1b2', kind: 'decoration', style: 'pixel-art', provider: 'pixellab',
      model: 'pixflux', recipeVersion: 'v1', prompt: 'a bush', width: 64, height: 64,
      tags: ['bush'], affinity: { biome: ['grassland'] }, generatedAt: 5,
    });
    const parsed = JSON.parse(line);
    expect(parsed.blob).toBe('blobs/decoration-a1b2.png');
    expect(parsed.key).toBe('a1b2');
    expect(line.endsWith('\n')).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/unit/promote-manifest-line.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the plugin**

Create `vite-plugins/promote-asset.ts`:

```ts
import type { Plugin } from 'vite';
import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface PromoteMeta {
  key: string;
  kind: string;
  style: string;
  provider: string;
  model: string;
  recipeVersion: string;
  prompt: string;
  width: number;
  height: number;
  tags: string[];
  affinity?: { biome?: string[]; era?: string[] };
  generatedAt: number;
  description?: string;
}

export function blobFileName(kind: string, key: string): string {
  return `${kind}-${key}.png`;
}

/** One NDJSON line (with trailing newline) for the manifest. */
export function buildManifestLine(meta: PromoteMeta): string {
  const rec = { ...meta, blob: `blobs/${blobFileName(meta.kind, meta.key)}` };
  return JSON.stringify(rec) + '\n';
}

/** Dev-only plugin: POST /__promote-asset { meta, blobBase64 } → write into public/. */
export function promoteAssetPlugin(): Plugin {
  const libDir = join(process.cwd(), 'public', 'asset-library');
  const blobsDir = join(libDir, 'blobs');
  const manifestPath = join(libDir, 'manifest.ndjson');

  return {
    name: 'promote-asset',
    apply: 'serve', // dev server only — never in the production build
    configureServer(server) {
      server.middlewares.use('/__promote-asset', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end('POST only'); return; }
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', async () => {
          try {
            const { meta, blobBase64 } = JSON.parse(body) as { meta: PromoteMeta; blobBase64: string };
            await mkdir(blobsDir, { recursive: true });
            await writeFile(join(blobsDir, blobFileName(meta.kind, meta.key)), Buffer.from(blobBase64, 'base64'));
            await appendFile(manifestPath, buildManifestLine(meta));
            res.statusCode = 200; res.end(JSON.stringify({ ok: true }));
          } catch (e) {
            res.statusCode = 500; res.end(String((e as Error).message));
          }
        });
      });
    },
  };
}
```

- [ ] **Step 4: Register it (dev only)**

In `vite.config.ts`, import and add to `plugins`:

```ts
import { promoteAssetPlugin } from './vite-plugins/promote-asset';
```

```ts
export default defineConfig(({ command }) => ({
  // ...existing...
  plugins: [promoteAssetPlugin()],
  // ...
}));
```

(`apply: 'serve'` makes it a no-op for `command === 'build'`.)

- [ ] **Step 5: Run the test + build**

Run: `npx vitest run tests/unit/promote-manifest-line.test.ts && npm run build`
Expected: test PASS; build PASS.

- [ ] **Step 6: Verify the plugin is absent from the prod bundle**

Run: `grep -r "__promote-asset" dist/ || echo "NOT IN BUNDLE (correct)"`
Expected: prints `NOT IN BUNDLE (correct)`.

- [ ] **Step 7: Commit**

```bash
git add vite-plugins/promote-asset.ts vite.config.ts tests/unit/promote-manifest-line.test.ts
git commit -m "feat(dev): Vite plugin to promote live assets into the vendored base library"
```

---

## Task 12: Seed the base library + dev "Generate & promote" action

**Files:**
- Create: `scripts/seed-base-library.mjs`
- Create: `public/asset-library/manifest.ndjson` (via the seed script)
- Create: `public/asset-library/blobs/*.png` (via the seed script)
- Modify: `src/ui/settings-unified.ts` (add a "Generate & promote to base" button calling `/__promote-asset`)

- [ ] **Step 1: Write the seed script**

Create `scripts/seed-base-library.mjs` — copies already-generated PNGs (e.g. `tmp/pixellab-probe/*.png`) into the base library with manifest lines, computing the same SHA-256 key the live cache would:

```js
import { readFile, writeFile, mkdir, appendFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'tmp/pixellab-probe');
const LIB = join(ROOT, 'public/asset-library');
const BLOBS = join(LIB, 'blobs');

// Minimal seed set — map probe file → metadata. Extend as you generate more.
const SEED = [
  { file: 'bush-32.png', prompt: 'a small round green bush', kind: 'decoration',
    tags: ['bush', 'green'], affinity: { biome: ['grassland', 'forest'] }, width: 64, height: 64 },
  { file: 'tree-32.png', prompt: 'a leafy oak tree', kind: 'decoration',
    tags: ['tree', 'oak'], affinity: { biome: ['forest'] }, width: 64, height: 64 },
];

const RECIPE_V = 'v1';
function keyFor(m) {
  // Mirror buildCacheKeyInput shape so live + base keys never collide on identity.
  const input = JSON.stringify({
    v: RECIPE_V, prompt: m.prompt, w: m.width, h: m.height, seed: 0,
    outline: 'single color black outline', shading: 'basic shading', detail: 'medium detail',
  });
  return createHash('sha256').update(input).digest('hex');
}

await mkdir(BLOBS, { recursive: true });
let manifest = '';
for (const m of SEED) {
  const key = keyFor(m);
  const png = await readFile(join(SRC, m.file));
  const blobName = `${m.kind}-${key}.png`;
  await writeFile(join(BLOBS, blobName), png);
  manifest += JSON.stringify({
    key, kind: m.kind, style: 'pixel-art', provider: 'pixellab', model: 'pixflux',
    recipeVersion: RECIPE_V, prompt: m.prompt, width: m.width, height: m.height,
    tags: m.tags, affinity: m.affinity, blob: `blobs/${blobName}`, generatedAt: 0,
  }) + '\n';
}
await writeFile(join(LIB, 'manifest.ndjson'), manifest);
console.log(`seeded ${SEED.length} assets into ${LIB}`);
```

- [ ] **Step 2: Run it**

Run: `node scripts/seed-base-library.mjs`
Expected: prints `seeded 2 assets`; `public/asset-library/manifest.ndjson` + two blob PNGs exist.

Verify: `ls public/asset-library/blobs/ && cat public/asset-library/manifest.ndjson`
Expected: two `.png` files and two manifest lines.

- [ ] **Step 3: Add the dev "Generate & promote" action**

In `src/ui/settings-unified.ts`, in the existing LLM/dev settings area, add a small form (prompt + tags) and a button whose handler:

```ts
import { generate, loadApiKey } from '@/services/pixellab';

async function generateAndPromote(prompt: string, tags: string[]): Promise<string> {
  const key = loadApiKey();
  if (!key) throw new Error('Save a PixelLab API key first.');
  const res = await generate(key, {
    prompt, width: 64, height: 64, kind: 'decoration',
    tags, origin: 'official', style: 'pixel-art',
  });
  const blob = await (await import('@/services/pixellab')).getAssetBlob(res.key);
  if (!blob) throw new Error('generated asset missing from cache');
  const blobBase64 = btoa(String.fromCharCode(...new Uint8Array(await blob.arrayBuffer())));
  const resp = await fetch('/__promote-asset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      meta: {
        key: res.key, kind: 'decoration', style: 'pixel-art', provider: 'pixellab',
        model: 'pixflux', recipeVersion: 'v1', prompt, width: 64, height: 64,
        tags, generatedAt: Date.now(),
      },
      blobBase64,
    }),
  });
  if (!resp.ok) throw new Error(`promote failed: ${await resp.text()}`);
  return res.key;
}
```

Wire it to a button with status text (mirror the decoration modal's `setStatus` pattern). Keep it inside the dev/settings section; it only works under `npm run dev` (the endpoint is dev-only). After promotion, tell the user to `git add public/asset-library && git commit`.

- [ ] **Step 4: Typecheck + build + full suite**

Run: `npx tsc --noEmit && npm run build && npm test`
Expected: all PASS.

- [ ] **Step 5: Manual end-to-end verification**

1. `npm run dev` → open the game (default iso).
2. Confirm the seeded bush/tree assets are queryable: place a decoration via right-click; the library grid shows kept assets and they render in **iso** (Task 10).
3. Switch topdown (`?render=topdown`) and confirm props with a matching seeded asset draw the sprite (Task 9). If no prop kind matches a seed tag yet, generate-and-promote one whose tags match a world prop kind, reload, and confirm.
4. Run `/__promote-asset` via the dev button on a fresh generation; confirm a new blob + manifest line appear under `public/asset-library/`.

- [ ] **Step 6: Commit**

```bash
git add public/asset-library scripts/seed-base-library.mjs src/ui/settings-unified.ts
git commit -m "feat(assets): seed base library + dev generate-and-promote action"
```

---

## Self-Review

**Spec coverage:**
- Two-tier storage (base + IndexedDB) → Tasks 4, 5, 7, 8. ✅
- Schema v3 metadata (provider/model/style/recipe/affinity) → Tasks 1, 2. ✅
- Query by field/filter (model/style/area), not folders → Tasks 3, 5. ✅
- Cache-or-generate + "runtime never blocks" → resolver is query-only (Task 6); generation only in the dev promote flow (Task 12). ✅
- Resolver, deterministic, render-only, no mutation → Task 6. ✅
- Vite promote plugin, dev-only, absent from prod → Task 11 (Step 6 asserts absence). ✅
- Pixel-art native, 64×64 → Tasks 2/12 generate at 64×64; no downscale. ✅
- Decorations in iso → Task 10. ✅
- Props wired (folded under `'decoration'` + entity kind as tag — spec open-question resolved) → Tasks 6, 9, 10. ✅
- Boot loader, subpath-safe, missing manifest tolerated → Task 4 (`loadBaseLibrary` returns [] on failure), Task 8. ✅
- Testing matrix (migration, loader, facade precedence/filters, acquire/pick branches, resolver determinism/no-mutation) → Tasks 2–7. ✅
- Deferred (nature/buildings/multi-provider/painterly) → explicitly out of this plan, noted in spec slice plan.

**Placeholder scan:** No TBD/TODO-as-work. The two `TODO(building-descriptor-cleanup)` references are pre-existing code comments, not plan placeholders. Manual-verification steps are explicit about what to check.

**Type consistency:** `AssetMeta`/`AssetRequest` (asset-match) are reused by `asset-library` and `art-resolver`; `ResolvedAsset.id`, `AssetLibrary.pick/query/resolveBlob`, `ArtResolver.resolve/peek/warm/clear`, `ArtImageCache(resolver)` signatures match across Tasks 3–10. `listKeptSummaries(kind)` defined in Task 2 is consumed in Task 5. `resolveEntityArt`/`resolveDecorationImage` on `RenderContext` are produced in Task 8 and consumed in Tasks 9–10. Manifest record shape is identical across Tasks 4, 11, 12.

**Known follow-up (not blocking):** the `acquire()` cache-or-generate method named in the spec is implemented on `AssetLibrary` only as far as `pick` + `resolveBlob` need; the generate-on-miss path lives in the dev promote flow (Task 12) per "runtime never blocks." A guarded background `acquire(allowGenerate)` is deferred to a later slice (spec §Slice 4+).
