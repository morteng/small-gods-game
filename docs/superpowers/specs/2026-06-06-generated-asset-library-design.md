# Generated Asset Library — Design

**Date:** 2026-06-06
**Status:** Design — awaiting review
**Topic:** A unified, metadata-rich asset library that ships a vendored **base library** with the game and grows during development, feeding generated pixel-art sprites to nature/buildings/props via a cache-or-generate selector. Builds on the existing PixelLab asset-library (`src/services/pixellab.ts`).

## Motivation

We want to **run the game with generated sprites** for nature, buildings, and props — and to **grow a base library while we develop gameplay** so the game looks good even with **no API key / no generative model configured**.

Today we have the machinery but not the goal:

- `src/services/pixellab.ts` — generate → IndexedDB cache → curated `findAssets()` query (`kind`/`tags`/`curated`/`origin`). Schema was *designed* to hold `'building'`/`'terrain-stamp'`/`'npc-sprite'` but those are **"future, not built."**
- The right-click **decoration** modal is the **only** end-to-end consumer, and **topdown only**.

What's missing:

1. A **base library that ships in the repo** (works offline / no key), distinct from the per-user IndexedDB cache.
2. **Generation metadata** (`model`, `provider`, `style`, recipe, affinity) so assets can be **reused when appropriate** and **filtered** ("only assets from model X", "only pixel-art", "desert biome").
3. A **selection seam** (`kind → art`) — the codebase currently dispatches art via scattered per-kind fallback chains with no registry.
4. A **promotion flow** to move good per-user generations into the shipped base library while developing.

## Goals / Non-goals

**Goals (this design):**
- Two-tier storage: vendored **base library** + per-user **live cache (IndexedDB)**, behind one query facade.
- Rich, queryable metadata; organization by **fields/filters**, never directory hierarchy.
- A **resolver** that binds world entities to library art deterministically.
- A **dev "generate & promote to base"** flow that writes into the repo.
- **Pixel-art native** sizing (no downscale); 64×64 default unit.

**Non-goals (deferred to follow-up slices):**
- Nature (trees/rocks) replacing vendored LPC sheets.
- Buildings (sprite-or-massing decision).
- Multi-provider generation beyond PixelLab (the **fields** are designed in; only PixelLab is wired).
- Painterly/hyperreal style + its generate-high-then-downscale path.
- Runtime *blocking* auto-generation (see "Runtime never blocks" below).

## Decisions (locked with the user, 2026-06-06)

| Axis | Decision |
|---|---|
| **Storage shape** | Vendored manifest (NDJSON) + blob files under `public/asset-library/`; IndexedDB stays the live cache. No SQLite. |
| **Primary style** | Pixel-art **native** — generate at target res, no downscale. 64×64 default; trees taller, buildings larger (later slices). |
| **First slice** | Schema + base library + cache-or-generate selector + wire **props + decorations** (incl. **iso**) + dev promote flow. |
| **Art binding (Fork A)** | **Resolver** keyed by `(kind, style, affinity)`, deterministic per entity id. No per-entity `assetId` stored for resolved kinds. |
| **Promote (Fork B)** | **Vite dev-server plugin** with a localhost-only write endpoint; excluded from the production build. |

## Architecture

```
┌─ BASE LIBRARY (vendored, ships) ──────┐     ┌─ LIVE CACHE (per-user) ─┐
│ public/asset-library/                 │     │ IndexedDB               │
│   manifest.ndjson  (metadata, 1/line) │     │ (on-demand generations) │
│   blobs/<kind>-<hash>.png             │     │                         │
└───────────────────────────────────────┘     └─────────────────────────┘
            └──────────────┬──────────────────────────────┘
                  AssetLibrary (unified query facade)
                  query({kind, style, model?, biome?, era?, tags?})  → AssetSummary[]
                  acquire(request)  → assetId | null   (cache-or-generate)
                  resolveImage(assetId) → HTMLImageElement | null  (non-blocking)
                           │
        ┌──────────────────┴───────────────────────┐
   render resolver (kind→assetId, per-entity hash)  dev panel (generate + promote)
```

One `AssetLibrary` facade queries **both** sources, **base-first**, and de-dupes by `key`. The renderer and worldgen never know which tier an asset came from (`sourceTier` is derived, for diagnostics only).

### Component boundaries

| Unit | File (new unless noted) | Responsibility | Depends on |
|---|---|---|---|
| `pixellab.ts` (existing) | `src/services/pixellab.ts` | Generation + IndexedDB cache + curation. Schema bump v2→v3. | IndexedDB, PixelLab API |
| Base loader | `src/services/base-library-loader.ts` | Fetch + parse `manifest.ndjson` at boot; expose in-memory base records; resolve blob URLs from `public/asset-library/blobs/`. | `asset-url.ts` |
| `AssetLibrary` facade | `src/services/asset-library.ts` | Unified base-first `query`/`acquire`/`resolveImage`. Cache-or-generate logic. | base loader, pixellab.ts |
| Art resolver | `src/render/art-resolver.ts` | `(entity, style) → assetId \| null`, deterministic per `entity.id`, memoized. **Render-only; never mutates entities.** | `AssetLibrary` |
| Promote endpoint | `vite-plugins/promote-asset.ts` + `vite.config.ts` | Dev-only `POST /__promote-asset` → write blob + append manifest line into repo. | Node fs (dev server only) |
| Dev promote UI | extend `src/ui/settings-unified.ts` / library panel | "Generate & promote to base" + library inspector showing new metadata. | `AssetLibrary`, promote endpoint |
| Render wiring | `src/render/renderer.ts`, `src/render/iso/*`, `render-context.ts` | Props resolve via art-resolver; decorations also drawn in **iso**. | art resolver |

## Data model (schema v2 → v3)

Extend the existing `LibraryAsset` (additive migration, like the v1→v2 bump already in `pixellab.ts`):

```ts
export interface LibraryAsset {
  // ── existing (v2) ───────────────────────────────
  key: string;                 // SHA-256 of canonical call shape
  schemaVersion: 3;            // bumped
  blob: Blob;
  prompt: string;
  width: number; height: number;
  generatedAt: number;
  curated: 'pending' | 'kept' | 'rejected';
  origin: 'sandbox' | 'official' | 'imported';
  kind: AssetKind;
  tags: string[];
  description?: string;

  // ── new (v3) ────────────────────────────────────
  provider: 'pixellab' | 'replicate' | 'fal' | 'mock';  // who generated it
  model: string;               // exact model id (e.g. 'pixflux')
  style: AssetStyle;           // 'pixel-art' | 'painterly' | …
  recipeVersion: string;       // frozen style recipe id (today's RECIPE_V)
  affinity?: { biome?: string[]; era?: string[] };  // soft selection hints
}

export type AssetStyle = 'pixel-art' | 'painterly' | 'unknown';
```

**Migration v2→v3** (in `openDb` `onupgradeneeded`, `DB_VERSION = 3`): backfill existing records with `provider: 'pixellab'`, `model: 'pixflux'`, `style: 'pixel-art'`, `recipeVersion: RECIPE_V`, `schemaVersion: 3`. No data loss.

**Manifest line** (NDJSON — everything except the blob, which lives as a file):

```json
{"key":"a1b2…","kind":"decoration","style":"pixel-art","provider":"pixellab","model":"pixflux","recipeVersion":"v1","prompt":"a small round green bush","width":64,"height":64,"tags":["bush","green"],"affinity":{"biome":["grassland","forest"]},"blob":"blobs/decoration-a1b2.png","generatedAt":1750000000000}
```

The base library is **curation-implied**: anything in the manifest is `curated: 'kept'`, `origin: 'imported'`, `sourceTier: 'base'`.

## Query & selection semantics

`AssetLibrary.query(filter)`:
- **Hard filters** (must match): `kind`, `style`. Optional hard: `model` (the *"only assets from model X"* case), `provider`.
- **Soft scoring**: `affinity.biome` / `affinity.era` / `tags` overlap → higher score.
- **Source precedence**: base and live merged, de-duped by `key`; base wins on tie (it's the curated truth).
- Returns scored, newest-first-within-score `AssetSummary[]`.

`AssetLibrary.acquire(request)` — **cache-or-generate**:
1. `query(request)` → if any hit, pick deterministically (best score; ties broken by `hash(request.seed)`), return its `key`.
2. miss **and** an image model is configured (PixelLab key present) **and** `request.allowGenerate` → `generate()` into IndexedDB, return new `key`.
3. otherwise → `null` (caller draws placeholder).

### Runtime never blocks on generation

Generation is ~15 s + network + cost. The **render path must never await it.** Therefore:
- The **art resolver** calls `query` + `resolveImage` only — **reuse-or-placeholder**, synchronous (mirrors today's `DecorationImageCache`: returns a cached `Image` or a placeholder, kicks a non-blocking blob→Image load).
- `acquire` with `allowGenerate` is invoked **only** from author-time/dev flows (the promote panel) or an explicit, clearly-async player action (e.g. the existing decoration modal) — **never** per-entity during a frame.

This keeps the frame loop honest and avoids silent slow failures.

## Art resolver (Fork A)

```ts
// src/render/art-resolver.ts — render-only, never mutates sim/entities
resolveArt(entity: Entity, style: AssetStyle): string | null
```

- Builds a request from `entity.kind` + `style` + the entity's tile biome/era (affinity).
- `query()` → candidates; pick **deterministically by `hash(entity.id)`** so each entity is stable across frames but neighbours vary.
- Memoized per `entity.id` (cleared on world reset).
- Returns `assetId | null`; `null` → renderer keeps the current procedural fallback (`drawEntityFallback`).
- **No write-back to the entity** → replay/determinism untouched (the resolver lives in `render/`, consuming nothing the sim reads). Decorations keep their explicit `assetId` and bypass the resolver.

## Promotion flow (Fork B)

- Dev panel button **"Promote to base"** on any kept IndexedDB asset (and a "Generate & promote" form).
- Browser `POST /__promote-asset` `{ key, metadata, blobBase64 }` → **Vite dev plugin** writes `public/asset-library/blobs/<kind>-<key>.png` and appends a line to `manifest.ndjson`.
- The plugin is registered only in dev (`apply: 'serve'`); the production build never includes it. Promotion is a **local-dev authoring action**; the dev then `git commit`s the new files.

## Sizing policy (pixel-art native)

- Style `pixel-art` → **generate at native target resolution, no downscale.**
- Default unit **64×64** for props/decorations (this slice). Trees taller (`64×96`/`64×128`) and buildings larger (`128`/`192`) are **defined but used in later slices**.
- A small `sizeForKind(kind)` table centralizes this; the cache key already includes width/height so different sizes never collide.
- (Decorations move from today's 32×32 to 64×64; existing 32px entries remain valid, just smaller.)

## Boot & persistence

- `base-library-loader.load()` runs in `bootstrap-world.ts` alongside `assets.loadAll()`, fetching `assetUrl('asset-library/manifest.ndjson')` (so it survives the GitHub-Pages subpath like the other 7 runtime assets).
- Missing/empty manifest → empty base library, game still runs (placeholders).
- No change to save/replay: art binding is render-only.

## Error handling

- Manifest parse: skip malformed lines, log a dev warning, keep the rest (no hard fail).
- Missing blob file referenced by a manifest line → that asset is dropped from the base set with a warning (don't 404-spam the renderer).
- Generation failure in `acquire` → surface to the caller (dev panel shows it, as the decoration modal already does); resolver path is unaffected (it never generates).
- Promote endpoint write failure → 500 with message; dev panel shows it.

## Testing

- **Schema migration** v2→v3 round-trip: existing record gains defaults, blob intact.
- **Base loader**: parse valid/invalid NDJSON; drop missing-blob lines; subpath URL.
- **AssetLibrary**: base/live merge + de-dupe by key, base-wins precedence; hard filter (`kind`/`style`/`model`) and soft affinity scoring.
- **`acquire`**: hit → reuse; miss+model+allowGenerate → generate; miss+no-key → null; `allowGenerate:false` → never generates.
- **Art resolver**: determinism per `entity.id` (stable across calls), variety across ids, `null` on no candidate, **no entity mutation**.
- **Render**: decorations now draw in iso (was topdown-only).
- Vite promote plugin: dev-only, manual-tested, **asserted absent from the prod bundle**.

## Slice plan

- **Slice 1 (this spec):** schema v3 + base library + `AssetLibrary` + selector + art resolver wired for **props + decorations (incl. iso)** + dev promote flow + seed a handful of base assets (the bush/tree we already generated, plus a few props).
- **Slice 2:** nature — trees/rocks resolve generated sprites, replacing/augmenting vendored LPC sheets; taller sizes.
- **Slice 3:** buildings — sprite-or-massing decision; building sizes.
- **Slice 4+:** multi-provider (Replicate/FAL), painterly style + downscale path, biome/era affinity taxonomy depth, optional guarded background runtime generation.

## Open questions (resolve during planning, not blocking)

- Exact `AssetKind` additions for "props" vs reuse of `'decoration'` — likely add `'prop'` or fold props under `'decoration'` with tags. Decide in the plan.
- Affinity taxonomy: reuse existing biome ids (`src/world/biome-regions.ts`) + `Era` (`src/core/era.ts`) — confirm the vocabularies line up.
