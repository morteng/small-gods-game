# Content-Version Cache-Busting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two manually-bumped version constants that bust stale caches — an ART/recipe version that retires metrically-wrong baked sprites in favour of the live parametric generator, and a WORLD/content version that discards stale autosaves.

**Architecture:** A new `src/core/content-version.ts` holds both constants. Gate A surfaces `recipeVersion` on the asset matcher and lets only the building art resolver opt into a version filter, so stale baked building art falls through to the parametric path. Gate B stamps the autosave with the world version and discards mismatches on load.

**Tech Stack:** TypeScript ES modules, Vitest. `@/` → `src/`. Dev server on port 3000.

**Disk/temp note:** the box runs near-full. Before any vitest run: `mkdir -p .tmp`, run with `TMPDIR=$PWD/.tmp`, and `rm -rf .tmp` before committing. Never `git add .tmp`. Commit explicit paths only (never `git add -A`). End commit bodies with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

**Spec:** `docs/superpowers/specs/2026-06-09-content-version-cache-busting-design.md`

---

## File Structure

- **Create** `src/core/content-version.ts` — the two version constants (single source of truth for bumps).
- **Create** `tests/unit/content-version.test.ts` — guards the constants exist and have the expected starting values.
- **Modify** `src/services/asset-match.ts` — `recipeVersion?` on `AssetMeta` + `AssetRequest`; one hard filter in `matchesAsset`.
- **Modify** `src/services/asset-library.ts` — `baseToMeta` threads `recipeVersion` (summary path untouched).
- **Modify** `src/render/art-resolver.ts` — optional `recipeVersion` 4th ctor arg, included in the pick request when set.
- **Modify** `src/game.ts:562-563` — pass `ART_RECIPE_VERSION` to `buildingArtResolver` only.
- **Modify** `src/core/save-file.ts` — `contentVersion` field on `SaveFile`, written in `toSaveFile`, checked in `applySaveFile`.
- **Test** `tests/unit/asset-match.test.ts`, `tests/unit/art-resolver.test.ts`, `tests/unit/save-file.test.ts` — extend existing files.

---

## Task 1: Version constants module

**Files:**
- Create: `src/core/content-version.ts`
- Test: `tests/unit/content-version.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/content-version.test.ts
import { describe, it, expect } from 'vitest';
import { ART_RECIPE_VERSION, WORLD_CONTENT_VERSION } from '@/core/content-version';

describe('content-version constants', () => {
  it('declares the current art recipe version (bumped to v2 to retire metrically-wrong baked art)', () => {
    expect(ART_RECIPE_VERSION).toBe('v2');
  });

  it('declares the current world content version', () => {
    expect(WORLD_CONTENT_VERSION).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `mkdir -p .tmp && TMPDIR=$PWD/.tmp npx vitest run tests/unit/content-version.test.ts`
Expected: FAIL — cannot resolve `@/core/content-version`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/core/content-version.ts
// Single source of truth for the two manually-bumped cache-busting versions.
// Bump a constant when you make a change you want reflected in-game without the
// player having to clear storage or hit "New World".

/**
 * Bump when building/asset GENERATION changes (geometry, metric scale, blueprint
 * output). A baked sprite whose `recipeVersion` differs from this is treated as
 * STALE and skipped, so the live parametric generator renders instead.
 * Regenerate the PixelLab base library at the new version to let baked art win
 * again. Started at 'v2' to retire the 'v1' baked art left metrically wrong by
 * the metric-scale standardization.
 */
export const ART_RECIPE_VERSION = 'v2';

/**
 * Bump when WORLDGEN / preset output changes (footprints, placement, heights).
 * An autosave stamped with a different value is discarded on load → a fresh
 * world is generated. Distinct from SAVE_VERSION (which guards the save *schema*).
 */
export const WORLD_CONTENT_VERSION = 1;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `TMPDIR=$PWD/.tmp npx vitest run tests/unit/content-version.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
rm -rf .tmp
git add src/core/content-version.ts tests/unit/content-version.test.ts
git commit -m "feat(cache): content-version constants (art recipe + world content)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Recipe-version filter in the asset matcher

**Files:**
- Modify: `src/services/asset-match.ts:4-13` (AssetMeta), `:15-24` (AssetRequest), `:27-34` (matchesAsset)
- Modify: `src/services/asset-library.ts:26-31` (baseToMeta)
- Test: `tests/unit/asset-match.test.ts`

The current `matchesAsset` (for reference):

```ts
export function matchesAsset(a: AssetMeta, req: AssetRequest): boolean {
  if (a.kind !== req.kind) return false;
  if (a.style !== req.style) return false;
  if (req.model && a.model !== req.model) return false;
  if (req.provider && a.provider !== req.provider) return false;
  if (req.size && (a.width !== req.size.w || a.height !== req.size.h)) return false;
  return true;
}
```

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/asset-match.test.ts`:

```ts
import { matchesAsset, type AssetMeta, type AssetRequest } from '@/services/asset-match';

describe('matchesAsset — recipeVersion gate', () => {
  const base: AssetMeta = {
    kind: 'building', style: 'pixel-art', model: 'pixflux', provider: 'pixellab',
    tags: ['yurt'], width: 64, height: 64,
  };
  const req: AssetRequest = { kind: 'building', style: 'pixel-art' };

  it('rejects an asset whose declared recipeVersion mismatches the request', () => {
    expect(matchesAsset({ ...base, recipeVersion: 'v1' }, { ...req, recipeVersion: 'v2' })).toBe(false);
  });

  it('accepts an asset whose declared recipeVersion matches the request', () => {
    expect(matchesAsset({ ...base, recipeVersion: 'v2' }, { ...req, recipeVersion: 'v2' })).toBe(true);
  });

  it('does not gate an asset that declares no recipeVersion (live runtime art)', () => {
    expect(matchesAsset({ ...base }, { ...req, recipeVersion: 'v2' })).toBe(true);
  });

  it('ignores recipeVersion entirely when the request omits it', () => {
    expect(matchesAsset({ ...base, recipeVersion: 'v1' }, req)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `mkdir -p .tmp && TMPDIR=$PWD/.tmp npx vitest run tests/unit/asset-match.test.ts`
Expected: FAIL — `recipeVersion` not on `AssetMeta`/`AssetRequest` (tsc error) and/or first assertion returns true.

- [ ] **Step 3: Add the fields + filter**

In `src/services/asset-match.ts`, add to `interface AssetMeta` (after `height: number;`):

```ts
  /** Generation recipe version. Present on base-library records; absent on live
   *  runtime art (which is current by construction). */
  recipeVersion?: string;
```

Add to `interface AssetRequest` (after `size?: { w: number; h: number };`):

```ts
  /** When set, gate out candidates that DECLARE a different recipeVersion. */
  recipeVersion?: string;
```

In `matchesAsset`, add this line before `return true;`:

```ts
  if (req.recipeVersion && a.recipeVersion && a.recipeVersion !== req.recipeVersion) return false;
```

- [ ] **Step 4: Thread recipeVersion onto base metas**

In `src/services/asset-library.ts`, `baseToMeta` — add `recipeVersion: r.recipeVersion` to the returned object:

```ts
function baseToMeta(r: BaseLibraryRecord): AssetMeta {
  return {
    kind: r.kind, style: r.style, model: r.model, provider: r.provider,
    tags: r.tags, affinity: r.affinity, width: r.width, height: r.height,
    recipeVersion: r.recipeVersion,
  };
}
```

Leave `summaryToMeta` unchanged — `AssetSummary` has no `recipeVersion`, so live metas stay `recipeVersion: undefined` and are never gated.

- [ ] **Step 5: Run tests to verify they pass**

Run: `TMPDIR=$PWD/.tmp npx vitest run tests/unit/asset-match.test.ts tests/unit/asset-library.test.ts`
Expected: PASS — new gate tests green, existing asset-library tests still green.

- [ ] **Step 6: Commit**

```bash
rm -rf .tmp
git add src/services/asset-match.ts src/services/asset-library.ts tests/unit/asset-match.test.ts
git commit -m "feat(cache): recipeVersion hard-filter in asset matcher (base art only)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: ArtResolver opts buildings into the recipe gate

**Files:**
- Modify: `src/render/art-resolver.ts:19-23` (constructor), `:29-34` (resolve request)
- Modify: `src/game.ts:562-563`
- Test: `tests/unit/art-resolver.test.ts`

Current constructor + request (for reference):

```ts
  constructor(
    private readonly lib: AssetLibrary,
    private readonly style: AssetStyle,
    private readonly assetKind: AssetKind = 'decoration',
  ) {}
  // ...
    const picked = await this.lib.pick({
      kind: this.assetKind,
      style: this.style,
      tagsAny: [e.kind],
      seed: hashStr(e.id),
    });
```

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/art-resolver.test.ts`:

```ts
describe('ArtResolver — recipeVersion opt-in', () => {
  it('passes recipeVersion in the pick request when constructed with one', async () => {
    const lib = { pick: vi.fn(async () => null) } as unknown as AssetLibrary;
    const r = new ArtResolver(lib, 'pixel-art', 'building', 'v2');
    await r.resolve(ent('cottage#1', 'cottage'));
    expect((lib.pick as any).mock.calls[0][0]).toMatchObject({ recipeVersion: 'v2' });
  });

  it('omits recipeVersion from the request when constructed without one', async () => {
    const lib = { pick: vi.fn(async () => null) } as unknown as AssetLibrary;
    const r = new ArtResolver(lib, 'pixel-art', 'decoration');
    await r.resolve(ent('flower#1', 'flower'));
    expect((lib.pick as any).mock.calls[0][0].recipeVersion).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `mkdir -p .tmp && TMPDIR=$PWD/.tmp npx vitest run tests/unit/art-resolver.test.ts`
Expected: FAIL — 4th ctor arg unused, request has no `recipeVersion`.

- [ ] **Step 3: Add the constructor arg + request field**

In `src/render/art-resolver.ts`, extend the constructor:

```ts
  constructor(
    private readonly lib: AssetLibrary,
    private readonly style: AssetStyle,
    private readonly assetKind: AssetKind = 'decoration',
    private readonly recipeVersion?: string,
  ) {}
```

In `resolve`, include it in the request only when set (object spread keeps it absent otherwise):

```ts
    const picked = await this.lib.pick({
      kind: this.assetKind,
      style: this.style,
      tagsAny: [e.kind],
      seed: hashStr(e.id),
      ...(this.recipeVersion ? { recipeVersion: this.recipeVersion } : {}),
    });
```

- [ ] **Step 4: Wire ART_RECIPE_VERSION into the building resolver**

In `src/game.ts`, add the import near the other `@/core` imports:

```ts
import { ART_RECIPE_VERSION } from '@/core/content-version';
```

Change lines 562-563 so only the building resolver opts in:

```ts
    this.artResolver = new ArtResolver(this.assetLibrary, 'pixel-art');
    this.buildingArtResolver = new ArtResolver(this.assetLibrary, 'pixel-art', 'building', ART_RECIPE_VERSION);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `TMPDIR=$PWD/.tmp npx vitest run tests/unit/art-resolver.test.ts`
Expected: PASS — both new tests green, existing memoize/score-0 tests still green.

- [ ] **Step 6: Commit**

```bash
rm -rf .tmp
git add src/render/art-resolver.ts src/game.ts tests/unit/art-resolver.test.ts
git commit -m "feat(cache): building art resolver gates on ART_RECIPE_VERSION

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: World content-version stamp on the autosave

**Files:**
- Modify: `src/core/save-file.ts` (SaveFile interface, toSaveFile, applySaveFile)
- Test: `tests/unit/save-file.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/save-file.test.ts` (uses the existing helpers in that file to build a saveable state; if the file already has a `makeState()`/round-trip helper, reuse it — otherwise build a save object literal as below and call `applySaveFile`):

```ts
import { WORLD_CONTENT_VERSION } from '@/core/content-version';
import { SAVE_VERSION, toSaveFile, applySaveFile, type SaveFile } from '@/core/save-file';

describe('save-file — world content version gate', () => {
  it('stamps the current WORLD_CONTENT_VERSION when saving', () => {
    const state = makeSaveableState(); // existing helper in this test file
    const save = toSaveFile(state, 123);
    expect(save.contentVersion).toBe(WORLD_CONTENT_VERSION);
  });

  it('applySaveFile rejects a save whose contentVersion mismatches', () => {
    const state = makeSaveableState();
    const save = toSaveFile(state, 123);
    const stale: SaveFile = { ...save, contentVersion: WORLD_CONTENT_VERSION + 1 };
    const fresh = makeSaveableState();
    expect(applySaveFile(fresh, stale)).toBe(false);
  });

  it('applySaveFile accepts a save whose version + contentVersion both match', () => {
    const state = makeSaveableState();
    const save = toSaveFile(state, 123);
    const fresh = makeSaveableState();
    expect(applySaveFile(fresh, save)).toBe(true);
  });
});
```

> If `tests/unit/save-file.test.ts` has no reusable state builder, copy the
> minimal world/map setup already used by its existing round-trip test into a
> local `makeSaveableState()` at the top of this describe block. Do not invent
> new world-construction helpers.

- [ ] **Step 2: Run test to verify it fails**

Run: `mkdir -p .tmp && TMPDIR=$PWD/.tmp npx vitest run tests/unit/save-file.test.ts`
Expected: FAIL — `contentVersion` not on `SaveFile`; `save.contentVersion` undefined.

- [ ] **Step 3: Add the field, stamp it, gate on it**

In `src/core/save-file.ts`:

Add the import at the top:

```ts
import { WORLD_CONTENT_VERSION } from '@/core/content-version';
```

Add to `interface SaveFile` (right after `version: number;`):

```ts
  /** World-content version (worldgen/preset output). Mismatch on load → discard
   *  and boot fresh. Distinct from `version`, which guards the save schema. */
  contentVersion: number;
```

In `toSaveFile`, add to the returned object (right after `version: SAVE_VERSION,`):

```ts
    contentVersion: WORLD_CONTENT_VERSION,
```

In `applySaveFile`, add the second guard right after the existing version check:

```ts
  if (save.version !== SAVE_VERSION) return false;
  if (save.contentVersion !== WORLD_CONTENT_VERSION) return false;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `TMPDIR=$PWD/.tmp npx vitest run tests/unit/save-file.test.ts`
Expected: PASS — new gate tests green, existing save round-trip tests still green.

- [ ] **Step 5: Commit**

```bash
rm -rf .tmp
git add src/core/save-file.ts tests/unit/save-file.test.ts
git commit -m "feat(cache): stamp + gate autosave on WORLD_CONTENT_VERSION

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Full verification + in-game eyeball

**Files:** none (verification only)

- [ ] **Step 1: Type-check + build**

Run: `npm run build`
Expected: tsc clean, Vite build emits `manifold.wasm`, no errors.

- [ ] **Step 2: Full test suite**

Run: `mkdir -p .tmp && TMPDIR=$PWD/.tmp npx vitest run; rm -rf .tmp`
Expected: all green (prior baseline 1622 passed / 306 files, now +~9 new tests). A lone `replay-speed`/`game-ui` timing flake that passes on a solo re-run is a flake, not a regression.

- [ ] **Step 3: In-game eyeball (manual)**

The dev server runs on port 3000 (`npm run dev` if not already up). Load the game.
- Because `ART_RECIPE_VERSION='v2'` retires all `v1` baked building art, every
  building should now render via the parametric generator.
- Hit **New World** to confirm worldgen + buildings render correctly with the
  parametric geometry (the baked PixelLab art should no longer appear).
- Verify the **yurt** renders as the squat embedded dome with the bored toono
  (the change that motivated this work).

> No automated assertion replaces this — a visual render catches geometry/scale
> bugs no unit test does. Report what you see.

- [ ] **Step 4: Final review**

Dispatch a final code-reviewer over the whole branch diff (`git diff main...HEAD`)
before finishing. Then use `superpowers:finishing-a-development-branch`.

---

## Self-Review

**Spec coverage:**
- Version module (two constants, manual bump) → Task 1. ✓
- Gate A: `recipeVersion?` on `AssetMeta`/`AssetRequest`, `a.recipeVersion &&`-guarded filter, base-only threading, `summaryToMeta` untouched → Task 2. ✓
- Gate A: building resolver opts in via 4th ctor arg; decoration resolver does not → Task 3. ✓
- Gate B: `contentVersion` field, stamped in `toSaveFile`, checked in `applySaveFile` alongside schema `version` → Task 4. ✓
- Testing trio (asset-match, building resolver, save-file) → Tasks 2-4. ✓
- Non-goals (no auto-hash, no migration, no PixelLab regen, no render-mode change) → respected; nothing in the plan touches them. ✓

**Placeholder scan:** none — every code step shows complete code. The one conditional (`makeSaveableState` reuse) gives an explicit fallback instruction rather than a TODO.

**Type consistency:** `recipeVersion?: string` consistent across `AssetMeta`, `AssetRequest`, the `matchesAsset` guard, the `ArtResolver` ctor arg, and the request spread. `contentVersion: number` consistent across `SaveFile`, `toSaveFile`, `applySaveFile`, and `WORLD_CONTENT_VERSION`. `ART_RECIPE_VERSION: 'v2'` (string) matches base records' `recipeVersion: string`.
