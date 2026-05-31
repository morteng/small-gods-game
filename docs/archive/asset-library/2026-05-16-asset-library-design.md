# Asset Library — Design

**Date:** 2026-05-16
**Status:** Design — awaiting review
**Topic:** Searchable, curated library of PixelLab-generated sprites for reuse by future LLM agents.

## Motivation

The PixelLab integration currently has an IndexedDB **cache** (`smallgods.pixellab.assets`) keyed by the SHA-256 of the call shape (prompt + size + recipe + seed). It guarantees that the *same* call never re-bills, but it cannot answer "do we already have a sprite that would work for what I need now?"

For the planned LLM DM (Phase 9+, not started), and for any other consumer that generates art on demand, we want a **menagerie**: a curated, metadata-annotated set of kept assets that callers query before deciding to generate something new. Goals:

1. **Reuse over regeneration** — query first, generate only on miss.
2. **Curation** — keep good assets, leave bad ones from sandbox use marked as pending.
3. **Future-proof for sharing** — schema serializable to JSON+blob bundles so a shared online bank becomes feasible later.

Out of scope this session: in-game consumer (right-click placement), real agent integration, bundle export/import, server-side shared bank.

## Scope (this session)

- Extend the IndexedDB store in place to carry asset metadata + curation state.
- Backfill migration for the small number of existing pending entries.
- Update `generate()` so callers can pass metadata along the "official path."
- A `findAssets()` lookup function and `getAssetBlob()` resolver.
- A minimal dev-side surface (in the existing settings panel) for generating-with-metadata and inspecting the library, sufficient to *populate* the library during development.

## Approach: extend the existing store in place (Approach A)

One IndexedDB database, one object store, schema-versioned. Bumping `DB_VERSION` runs a migration that adds the new fields with safe defaults on existing entries. No parallel state.

Rationale:
- Today's cache and tomorrow's library share the same record-keyed-by-hash design — only the *metadata around the blob* needs to grow.
- A single store means one place to look up, one place to migrate, one place to export.
- "Pending vs kept" is just a field; no separate sandbox database.

## Data model

```ts
export type AssetKind =
  | 'decoration'    // tree, rock, shrine, lamppost, banner — y-sorted decoration layer
  | 'building'      // standalone building or building part
  | 'npc-portrait'  // single still, no animation
  | 'npc-sprite'    // walk-cycle sheet (future; designed-for, not built)
  | 'icon'          // UI / overlay icon
  | 'terrain-stamp' // single terrain detail (future)
  | 'unknown';      // pre-migration entries

export type CurationStatus = 'pending' | 'kept' | 'rejected';

export type AssetOrigin =
  | 'sandbox'   // settings-panel test-generate — stays pending unless promoted
  | 'official'  // gameplay flow or agent call — auto-kept
  | 'imported'; // future: came from a bundle

export interface LibraryAsset {
  // Identity
  key: string;             // SHA-256 of canonical call shape (unchanged from cache)
  schemaVersion: 2;        // current schema version

  // Blob + minimal call shape (unchanged)
  blob: Blob;
  prompt: string;
  width: number;
  height: number;
  generatedAt: number;     // epoch ms

  // Curation + provenance
  curated: CurationStatus;
  origin: AssetOrigin;

  // Searchable metadata (caller-supplied via official path; defaulted for sandbox)
  kind: AssetKind;
  tags: string[];          // lowercase, deduped on write
  description?: string;    // optional human-readable summary
}
```

**Indexes (IndexedDB):**
- Primary key: `key`
- Index on `kind`
- Index on `curated`
- Multi-entry index on `tags` (so a tag lookup is a single IDB cursor scan)

Compound `(kind, curated)` queries are done by scanning the `kind` index and filtering on `curated` in memory — counts are small enough (hundreds, not millions) that we don't need a compound index.

## API surface

All in `src/services/pixellab.ts`:

```ts
// Existing — gains optional metadata
export interface PixelLabGenerateOpts {
  // ...existing fields (prompt, width, height, outline, shading, detail, seed)

  // NEW — metadata for library entry
  kind?: AssetKind;          // required for 'official' origin; defaults to 'unknown' otherwise
  tags?: string[];           // normalized lowercase + deduped on write
  description?: string;
  origin?: AssetOrigin;      // defaults to 'sandbox'
}

// New — library lookup. Designed for the future LLM agent's tool call.
export interface AssetQuery {
  kind: AssetKind;
  tagsAny?: string[];   // OR-match
  tagsAll?: string[];   // AND-match
  size?: { w: number; h: number };
  limit?: number;       // default 16
}

export interface AssetSummary {
  id: string;           // = LibraryAsset.key
  kind: AssetKind;
  tags: string[];
  prompt: string;
  description?: string;
  width: number;
  height: number;
  addedAt: number;
}

export function findAssets(q: AssetQuery): Promise<AssetSummary[]>;
export function getAssetBlob(id: string): Promise<Blob | null>;

// New — curation actions (used by dev panel; future agent could also call)
export function markAssetKept(id: string): Promise<void>;
export function markAssetRejected(id: string): Promise<void>;
export function updateAssetMetadata(
  id: string,
  patch: Partial<Pick<LibraryAsset, 'kind' | 'tags' | 'description'>>,
): Promise<void>;
```

**`findAssets` semantics:**
- `kind` is required — narrows the search space immediately.
- Returns only `curated === 'kept'` assets. Pending and rejected are invisible to callers.
- Results are ordered by `generatedAt DESC` (newest first) for stable iteration.
- `tagsAll` is the strict filter; `tagsAny` is OR'd into the result set. If both are provided, results must satisfy `tagsAll` AND match at least one of `tagsAny`.
- `size` is exact match. (No "approximate size" v1 — the agent can issue multiple queries if it needs flexibility.)

## Generation flow (revised)

```
caller → generate(apiKey, opts)
       ↓
   buildCacheKeyInput  (unchanged: hashes prompt + size + recipe + seed)
       ↓
   IDB lookup by key
       ├── HIT  → return {blob, cached: true, key}
       └── MISS → POST /create-image-pixflux → blob
                ↓
                cachePut({
                  key, blob, prompt, width, height, generatedAt,
                  schemaVersion: 2,
                  curated: origin === 'official' ? 'kept' : 'pending',
                  origin: opts.origin ?? 'sandbox',
                  kind: opts.kind ?? 'unknown',
                  tags: normalizeTags(opts.tags ?? []),
                  description: opts.description,
                })
                return {blob, cached: false, key}
```

Caching behavior is unchanged. The only difference: on a fresh write, additional metadata fields are populated from `opts`. On a cache hit, the existing entry is returned as-is — even if its metadata is poor — because the contract is "same call shape → same bytes."

**Promotion on cache hit:** if a sandbox-origin asset is later re-requested with `origin: 'official'`, the existing entry is updated in place (`curated: 'kept'`, plus any new metadata from `opts`). Implemented as part of the hit path. This lets the same asset get promoted into the library without needing a second generation.

## Migration (DB_VERSION 1 → 2)

In `openDb` `onupgradeneeded`:
1. If upgrading from v1, open a cursor over every existing record and rewrite each with:
   - `schemaVersion: 2`
   - `curated: 'pending'`
   - `origin: 'sandbox'`
   - `kind: 'unknown'`
   - `tags: []`
2. Create the three new indexes (`kind`, `curated`, `tags` multi-entry).

Existing test-generate entries land as `pending/unknown/sandbox`. Invisible to `findAssets` until promoted. Safe default.

## Population path (dev tool)

The existing settings panel (`src/ui/settings-panel.ts`) already has a test-generate flow. Extend it:
- Add a small "Library" tab/section.
- Generation form gains: `kind` (select), `tags` (comma-separated input), `description` (optional textarea), `origin` toggle (sandbox vs official).
- Below the form, list recent library entries with thumbnail + metadata + Keep/Reject buttons.
- Selecting Keep on a pending entry promotes it to `kept` and lets the user fill in/correct `kind` and `tags`.

This is the only UI built this session. No right-click flow. No agent stub. The settings panel is sufficient to seed the library by hand during development.

## Testing

Unit tests in `tests/unit/pixellab.test.ts` (existing file, currently 11 tests). Add:
- Schema migration: v1 records get migrated to v2 with safe defaults.
- `generate` with `origin: 'official'` writes `curated: 'kept'` and `kind/tags` from opts.
- `generate` with `origin: 'sandbox'` (default) writes `curated: 'pending'`.
- Cache-hit promotion: sandbox entry re-requested as official is updated to kept.
- `findAssets({kind})` excludes pending and rejected.
- `findAssets({kind, tagsAll: [...]})` AND-filters correctly.
- `findAssets({kind, tagsAny: [...]})` OR-filters correctly.
- `findAssets({kind, tagsAll, tagsAny})` combines correctly.
- `findAssets({kind, size})` exact-matches dimensions.
- `findAssets({kind, limit})` respects limit and orders by `generatedAt DESC`.
- `markAssetKept` / `markAssetRejected` / `updateAssetMetadata` round-trip through IDB.
- `normalizeTags` lowercases and dedups input.

Settings-panel UI changes verified in-browser manually (the test plan accompanying the implementation plan will list specific scenarios).

## Out of scope (deferred)

- **Right-click decoration placement.** Will reuse `findAssets` + `generate({origin:'official'})` when built.
- **Real agent integration.** Same surface.
- **Bundle export/import.** Schema is JSON-serializable except for `Blob`. A future exporter will pair a JSON manifest with the blob bytes. No code this session.
- **Shared online bank.** A future server. Schema and origin field (`'imported'`) are placeholders so the eventual import path doesn't need a migration.
- **Semantic / embedding search.** `findAssets` could grow a `q?: string` parameter for free-text or vector search later without breaking existing callers.
- **Compound `(kind, curated)` IndexedDB index.** Unnecessary at current scale; revisit if scans get slow.

## Files touched (estimate)

- `src/core/types.ts` — add `AssetKind`, `CurationStatus`, `AssetOrigin`, `LibraryAsset`, `AssetQuery`, `AssetSummary`. Replace `PixelLabCachedAsset` with `LibraryAsset` (only internal references — small change).
- `src/services/pixellab.ts` — schema migration, generate flow, new exports (`findAssets`, `getAssetBlob`, `markAssetKept`, `markAssetRejected`, `updateAssetMetadata`, `normalizeTags`).
- `src/ui/settings-panel.ts` — library section with curation UI.
- `tests/unit/pixellab.test.ts` — new tests.

No changes to renderer, game loop, or world state. The library is a standalone service.
