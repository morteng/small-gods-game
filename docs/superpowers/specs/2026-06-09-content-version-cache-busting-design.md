# Content-Version Cache-Busting — Design

**Date:** 2026-06-09
**Status:** Approved (brainstorm)
**Builds on:** [[project-metric-scale-standardization]], [[project-live-parametric-building-rendering]], [[project-blueprint-parameter-model]]

## Problem

After the metric-scale + parametric-geometry work, in-game buildings still render
the **old baked PixelLab sprites**, not the new parametric geometry. Two
independent staleness paths cause this:

1. **Art staleness (baked beats parametric).** `public/asset-library/manifest.ndjson`
   ships 12 baked building sprites (cottage, tavern, yurt, …), each tagged by kind
   with `recipeVersion:"v1"`. In `auto` mode, `pickBuildingSource`
   (`src/render/iso/iso-building.ts:154`) returns `'asset'` whenever *any* baked
   sprite matches the kind, so the baked PNG always outranks the parametric
   generator. The metric/geometry work only changed the parametric path, so it
   never shows. The baked art is now also *metrically wrong* (authored at the old
   scale).

2. **World autosave staleness.** Preset/worldgen changes (footprints, heights,
   placement) don't reach an already-saved world — the IndexedDB autosave restores
   the prior snapshot. A `SAVE_VERSION` lever exists (`src/core/save-file.ts:10`,
   mismatch → boot fresh, no migration) but is for *save schema*, not content, and
   is bumped by hand for a different reason.

## Decisions (from brainstorm)

- **Scope:** solve **both** art and world staleness.
- **Art priority:** *parametric wins when newer* — version-gate baked art rather
  than blanket-deprecating it. Baked art that matches the current recipe version
  still wins; older baked art gives way to the live parametric path.
- **Knobs:** **two separate versions** — an ART/recipe version and a WORLD/content
  version — so an art tweak doesn't nuke the world you're eyeballing, and a
  worldgen tweak doesn't force-regenerate art.
- **Bump trigger:** **manual constant bump**. No auto-derived hashing.

## Architecture

One new module, `src/core/content-version.ts`, holding two manually-bumped
constants. Each gates exactly one staleness path. No auto-hashing.

```ts
// src/core/content-version.ts

/** Bump when building/asset GENERATION changes (geometry, metric scale, blueprint
 *  output). A baked sprite whose recipeVersion differs is treated as STALE and
 *  skipped, so the live parametric generator renders instead. Regenerate PixelLab
 *  art at the new version to let baked art win again. */
export const ART_RECIPE_VERSION = 'v2';

/** Bump when WORLDGEN / preset output changes (footprints, placement, heights).
 *  An autosave stamped with a different value is discarded → fresh world on load. */
export const WORLD_CONTENT_VERSION = 1;
```

`ART_RECIPE_VERSION` starts at `'v2'`: every vendored baked building is `'v1'`, so
all of them become stale on the first load after this ships, and the parametric
geometry renders game-wide. `WORLD_CONTENT_VERSION` starts at `1`; bumping it later
discards old autosaves.

## Gate A — art (baked vs parametric), buildings only

**Surface `recipeVersion` on the shared metadata + add an optional request filter.**

`src/services/asset-match.ts`:
- Add `recipeVersion?: string` to `interface AssetMeta` (optional — live assets
  don't carry one).
- Add `recipeVersion?: string` to `interface AssetRequest`.
- In `matchesAsset`, add one hard filter (mirroring the existing kind/style ones):
  ```ts
  if (req.recipeVersion && a.recipeVersion && a.recipeVersion !== req.recipeVersion) return false;
  ```
  The `a.recipeVersion &&` guard is deliberate: an asset is filtered out **only
  when it declares a recipe version that mismatches**. An asset with no declared
  version (live runtime art) is never gated. When the request omits
  `recipeVersion`, behaviour is unchanged.

**Thread `recipeVersion` into the base metas only.**

`src/services/asset-library.ts` builds an `AssetMeta` via `baseToMeta` (base
records) and `summaryToMeta` (live summaries) before matching.
- `baseToMeta`: add `recipeVersion: r.recipeVersion` — base records always carry it
  (`base-library-loader.ts:13`).
- `summaryToMeta`: **leave unchanged** — `AssetSummary` has no `recipeVersion`
  field, so its meta's `recipeVersion` stays `undefined`. Live runtime art is
  generated at the current recipe by construction, so it must never be gated out.
  No change to `AssetSummary` / `core/types.ts`.

**Only the building resolver opts in.**

`src/render/art-resolver.ts` `resolve()` builds the `pick` request. Give
`ArtResolver` an optional `recipeVersion` 4th constructor arg (default
`undefined`) and include it in the request only when set. The resolvers are
constructed in `src/game.ts:562-563`:

```ts
this.artResolver = new ArtResolver(this.assetLibrary, 'pixel-art');
this.buildingArtResolver = new ArtResolver(this.assetLibrary, 'pixel-art', 'building', ART_RECIPE_VERSION);
```

Pass `ART_RECIPE_VERSION` to the **`buildingArtResolver`** only; leave the
decoration `artResolver` without it.

> Decorations have no parametric fallback; gating them by recipe version would make
> non-matching decorations disappear. The filter must be building-scoped.

**Effect:** with `ART_RECIPE_VERSION='v2'` and all baked buildings at `'v1'`,
`buildingArtResolver.resolve` finds no version-matching baked asset → returns null
→ `resolveBuildingArt` returns null → `pickBuildingSource` falls through to
`'parametric'` → parametric geometry renders for every building. No
`pickBuildingSource` signature change.

**Accepted consequence:** the whole town switches from baked PixelLab art to
parametric geometry until baked art is regenerated at `v2`. Intended — the baked
art is metrically wrong and parametric is the path under active iteration; the
preview gallery confirms all 12 presets render cleanly.

## Gate B — world autosave

`src/core/save-file.ts`:
- Add `contentVersion: number` to `interface SaveFile`.
- In `toSaveFile`, write `contentVersion: WORLD_CONTENT_VERSION` (import from
  `content-version.ts`).
- In `applySaveFile` (the rehydrate function; there is no separate `isLoadable`),
  reject on content-version mismatch alongside the existing schema check:
  ```ts
  if (save.version !== SAVE_VERSION) return false;
  if (save.contentVersion !== WORLD_CONTENT_VERSION) return false;
  ```
  Both checks sit at the top of `applySaveFile`, before any mutation, so a
  mismatch returns false having changed nothing. Old saves lacking the field →
  `undefined !== 1` → discarded (correct; they predate the field and are stale
  anyway).

Kept distinct from `SAVE_VERSION` so schema/migration concerns and content-refresh
concerns don't entangle.

## Testing

- **`asset-match`:** `matchesAsset` rejects a meta whose `recipeVersion` differs
  from a request that carries one; passes when they match; ignores the field when
  the request omits it.
- **building resolver:** a baked asset at `'v1'` resolved with
  `recipeVersion:'v2'` → `resolve` returns null (parametric path taken); the
  decoration resolver (no `recipeVersion`) is unaffected and still binds.
- **`save-file`:** `contentVersion` mismatch → `isLoadable` false; schema +
  content both matching → true; missing `contentVersion` → false.

## Non-goals

- No auto-derived version hashing.
- No migration of stale saves (discard + fresh, matching existing `SAVE_VERSION`
  behaviour).
- No regeneration of baked PixelLab art in this work (manual, paid, separate).
- No change to the `buildingRenderMode` dev toggle.
