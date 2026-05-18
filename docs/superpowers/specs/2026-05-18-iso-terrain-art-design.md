# Iso Terrain Art (PR 2 of iso renderer) — Design Spec

> **⚠️ SUPERSEDED (2026-05-18, same day):** This design assumed PixelLab's `create-image-pixflux` endpoint would accept a 5×3 primitive sheet at 640×192 with a custom view-angle field, then we'd procedurally compose 47 blob variants from the primitives. At first call against the live API both assumptions failed: `image_size` caps at 400×400 per dim, and `view` is a strict enum (`'side' | 'low top-down' | 'high top-down'` — no iso). Worse, deeper API-doc reading revealed `create-tileset` natively generates Wang/47-blob terrain transitions, making the composer module redundant.
>
> **Replaced by:** [Iso Terrain Art — Pivot (create-tileset) Design](2026-05-18-iso-terrain-art-pivot-design.md). The composer module (`src/render/iso/blob-composer.ts`) + its 15 unit tests are dropped. The atlas-loader, iso-renderer factory, and select-renderer wiring (Tasks 4–8 of the original plan) are kept since they're agnostic to how the PNGs are produced.
>
> Lesson captured in the auto-memory: see `feedback_pixellab_api_depth.md` and the new PixelLab API surface section in `hosted-image-api-research-2026-05.md`. The original spec text below is kept for historical reference.

---

**Status:** ~~Design (2026-05-18) — pending implementation plan~~ **SUPERSEDED 2026-05-18**
**Author:** brainstormed via Claude + Morten
**Related:** [Iso renderer design](2026-05-18-iso-renderer-design.md), [HANDOFF_ISO_RENDERER.md](../HANDOFF_ISO_RENDERER.md)
**Predecessor:** [PR 1 iso scaffold](../plans/2026-05-18-iso-renderer-scaffold.md) (merged in PR #6, commit `db804a4`)

## Summary

Produce and ship the iso renderer's terrain art: one 47-variant blob atlas PNG per base terrain type (water, sand, dirt, grass, stone, rocky), generated at author time from a single PixelLab "primitive sheet" per type via a procedural quadrant-minitile composer, then committed under `public/sprites/iso/terrain/`. Wire the existing `blob-autotiler` into `iso-terrain.ts` so each rendered tile selects the correct one of 47 variants based on its 8-neighbor mask. The composer is a single pure function used by the author-time Node script (and exercised by unit tests); the runtime atlas loader just reads pre-baked PNGs. Falls back per-type to the existing diamond `TILE_COLORS` path when a sheet is missing; the iso flag remains functional with zero art.

## Goals

- Iso terrain renders as real pixel art instead of flat diamonds, for all 6 base terrain groups.
- Single PixelLab call per terrain type (6 total) at author time — not 282 per-variant calls.
- Composer is a single pure function called by the Node baking script; unit tests exercise the same function with synthetic input. Runtime is decoupled — it just reads pre-baked PNGs.
- Per-type fallback: missing or 404'd sheets fall through to diamond stamps; other types still render.
- Top-down renderer behavior unchanged; sim, snapshot/timeline, event log untouched. (The `blob-autotiler` refactor may rename a top-down call site if it duplicates the new `blobVariantAt` logic — semantics preserved.)

## Non-goals

See the iso renderer design spec's "Out of scope" section. PR-2-specific exclusions:

- Iso buildings, characters, trees, decorations — those are PRs 3/4/5.
- Runtime PixelLab regeneration UI — committed PNGs only, no in-browser regen.
- Pixel-perfect terrain output tests (too brittle; rationale per iso renderer design spec line 186).
- Iso road group — road group has no terrain sheet and routes through Kenney directional sprites (per `blob-autotiler.ts:46`).
- Iso void treatment / past-veil iso polish — Spec D revision territory.

## Architectural decisions (locked during brainstorm)

| Decision | Choice |
|---|---|
| Generation strategy | Base sprite per terrain type + procedural 47-variant compositor |
| Where the atlases live | Pre-bake at author time, commit PNGs to `public/sprites/iso/terrain/` |
| Composer algorithm | Quadrant-minitile blob47 composition ([cr31.co.uk/stagecast/wang/blob](https://www.cr31.co.uk/stagecast/wang/blob.html)) |
| Composer reuse | One pure function called by Node script, exercised by unit tests; not used at runtime (runtime reads pre-baked PNGs) |
| Primitive sheet layout | 5 cols × 3 rows of 128×64 cells (640×192 PNG) per terrain type |
| Output atlas layout | 6 cols × 8 rows of 128×64 cells (768×384 PNG) per terrain type, blob index *i* at `((i % 6) * 128, floor(i / 6) * 64)` |
| Fallback granularity | Per-type — one missing sheet doesn't blank the others |
| Node canvas library | `@napi-rs/canvas` (no native compile; portable on Apple Silicon) |
| Atlas mount point | `selectRenderer()` returns `{renderMap, atlas}` (no `RenderContext` widening) |

## Scope & deliverables

PR 2 ships:

1. **`scripts/gen-iso-terrain.ts`** — Node script that calls PixelLab once per terrain type and writes a 47-variant atlas PNG. Idempotent.
2. **`src/render/iso/blob-composer.ts`** — pure-function compositor turning one primitive sheet into 47 blob cells. Called by the script (`@napi-rs/canvas`) and exercised by unit tests (`OffscreenCanvas` under vitest). Not used at runtime — runtime reads pre-baked PNGs.
3. **6 committed PNGs** at `public/sprites/iso/terrain/<type>-blob47.png` — 768×384, one per base terrain group.
4. **`src/render/iso/iso-atlas-loader.ts`** — replaces `createNullAtlas()` at runtime; loads the 6 PNGs in parallel, exposes a real `IsoAtlas` whose `getTerrain(type, variant)` returns the right cell slice.
5. **`src/render/select-renderer.ts`** updated — returns `{renderMap, atlas}`; iso path loads atlas before first render, topdown returns `atlas: null`.
6. **Blob-autotiler refactor** — `src/map/blob-autotiler.ts` exports `TERRAIN_GROUPS` and a new `blobVariantAt(map, tx, ty)` helper. Existing top-down callers (if any) migrate to it; iso-terrain consumes it.
7. **Wire blob-autotiler into iso-terrain** — `src/render/iso/iso-terrain.ts:28` changes from `atlas.getTerrain(tileType, 0)` to `atlas.getTerrain(tileType, blobVariantAt(map, tx, ty))`.
8. **Tests** — composer unit (~12), atlas loader (~5), iso-terrain integration (~3).

Top-down renderer untouched. Flag stays dev-only. Spec B/C/D unaffected.

## Composer input/output contract

This is the load-bearing module — its correctness gates whether tiles butt up seamlessly.

### Input contract

Each terrain type → one PixelLab image, a fixed-layout 5×3 primitive sheet (640×192 PNG, cells 128×64 each):

| Row | Col 0 | Col 1 | Col 2 | Col 3 | Col 4 |
|---|---|---|---|---|---|
| 0 | NW-outer-corner | N-edge | NE-outer-corner | isolated-tile | isolated-with-edge |
| 1 | W-edge | center (X-surrounded-by-X) | E-edge | NW-inner-corner | NE-inner-corner |
| 2 | SW-outer-corner | S-edge | SE-outer-corner | SW-inner-corner | SE-inner-corner |

A single PixelLab prompt describes the whole sheet. Example template for grass:

> *"iso 2:1 dimetric grass terrain primitive sheet, 5×3 grid of 128×64 transition tiles for blob autotiling. Top row: outer corners and N-edge. Middle row: W/E edges, interior grass tile, and inner corners. Bottom row: bottom corners and S-edge. Single-color black outline, basic shading, medium detail."*

PixelLab call uses `STYLE_RECIPE` (project default) + a `view: 'side-front-2-1-isometric'` parameter — **exact PixelLab field name confirmed at call-site against the live API** (this was the open question deferred from the iso renderer design spec at line 220). If the field name turns out to be different, fix in `buildRequestBody()` or in the script-local request body builder; do not block the rest of PR 2.

A fixed per-type `seed` lives in the script so re-running produces byte-identical primitives.

### Algorithm

Standard quadrant-minitile blob47 composition. Each of the 47 output cells is built from 4 quadrant samples (top-left, top-right, bottom-left, bottom-right). Per quadrant, the composer inspects 3 of the 8 neighbors (the two cardinals adjacent to that corner + the diagonal between them) from the blob mask and picks the matching primitive's quadrant via a 8-row lookup table (3 bits → primitive id + quadrant offset).

The same `BLOB_INDEX_MAP` already in `blob-autotiler.ts` maps 8-bit neighbor masks → output cell index 0..46. The composer's outer loop is `for index in 0..47 → compose 4 quadrants → blit to (col, row) in target`.

Reference: [cr31.co.uk/stagecast/wang/blob.html](https://www.cr31.co.uk/stagecast/wang/blob.html).

### Output contract

A 768×384 canvas (6 cols × 8 rows × 128×64), with blob index *i* drawn at `((i % 6) * 128, floor(i / 6) * 64)`. Cell at the unused 48th slot left transparent.

Node script writes this to disk as `<type>-blob47.png`. Runtime atlas loader reads it and the `IsoAtlas.getTerrain(type, variant)` returns `{img, sx: (variant % 6) * 128, sy: Math.floor(variant / 6) * 64, sw: 128, sh: 64}`.

### Composer signature

```ts
// src/render/iso/blob-composer.ts
export function composeBlob47Atlas(
  primitives: HTMLImageElement | OffscreenCanvas | ImageBitmap,
  target: OffscreenCanvas,  // 768x384, allocated by caller
): void;
```

Pure / no side effects beyond drawing into `target`. The script provides an `@napi-rs/canvas` `Canvas` cast to the same surface contract (a thin shim in the script normalizes the type). Tests use `OffscreenCanvas` under vitest. The browser runtime does not call this function — it loads pre-baked PNGs — but the signature accepts `OffscreenCanvas` so the function stays usable if a future PR ever needs runtime composition.

## Author-time pipeline

### Script: `scripts/gen-iso-terrain.ts`

A Node ES module run via `npm run gen:iso-terrain` (new package.json script). Reads `PIXELLAB_API_KEY` from env. For each of the 6 terrain types in a fixed list:

1. Build a `PixelLabGenerateOpts` with a per-type prompt + the project `STYLE_RECIPE` + a fixed `seed` per terrain type.
2. Compute the SHA-256 cache key via `buildCacheKeyInput()` (exported from `src/services/pixellab.ts`). If `var/iso-terrain-cache/<sha>.png` exists on disk, use it. Otherwise call PixelLab via a thin Node helper that shares `buildRequestBody()` with `src/services/pixellab.ts` and writes the response to the disk cache.
3. Decode the PNG into an `@napi-rs/canvas` Image. Allocate a 768×384 canvas. Call `composeBlob47Atlas(primitives, target)`.
4. Write `public/sprites/iso/terrain/<type>-blob47.png` via `target.encode('png')`.
5. Log: `[gen-iso-terrain] grass: cached / generated, wrote 768x384 PNG (87.2 KB)`.

### Idempotency

Same script run with no code changes → no PixelLab calls, byte-identical PNGs written. This is what makes the script committable: a reviewer can run it and verify the PNGs in the PR match.

### Cost

6 PixelLab calls per fresh run (~$0.05–0.15 at pixflux rates). The disk cache amortizes that across runs. Author commits to running the script once per visual iteration; reviewers don't need to re-run.

### Disk cache

Path: `var/iso-terrain-cache/<sha256>.png`. Gitignored (add to `.gitignore` in PR 2). SHA matches the browser IndexedDB key for the same prompt+style+seed, so a browser run that hit the cache and a script run can pull from the same artifact if a workflow ever needs that (no such workflow today, but the alignment is free).

### Dependencies added

- `@napi-rs/canvas` as dev dependency. No native compile required. Cross-platform Apple Silicon-friendly.

### What's not in the script

No automatic git commit, no PR creation, no quality scoring. Human reviews the PNGs in the diff before merging.

## Runtime atlas loader & wiring

### `src/render/iso/iso-atlas-loader.ts`

New module. Exports:

```ts
export async function loadIsoTerrainAtlas(): Promise<IsoAtlas>;
```

Fires 6 `Image` loads in parallel from `/sprites/iso/terrain/<type>-blob47.png`. Each resolves to `{img: HTMLImageElement, loaded: true}` or `{img: null, loaded: false}` on load error. Returns an `IsoAtlas` whose `getTerrain(type, variant)` is:

```ts
const entry = sheets[type];
if (!entry?.img) return null;  // per-type fallback
return {
  img: entry.img,
  sx: (variant % 6) * 128,
  sy: Math.floor(variant / 6) * 64,
  sw: 128, sh: 64,
};
```

`getBuilding`, `getCharacter`, `getTree` keep returning `null` — those are PRs 3/4/5. PR 2 only widens `getTerrain`.

### Mount point

`src/render/select-renderer.ts` extends its return shape: `{renderMap, atlas}`. The iso branch awaits `loadIsoTerrainAtlas()` after dynamic-importing the iso renderer module. Top-down branch returns `atlas: null`. `game.ts` stores the atlas alongside the renderMap and passes it on every `renderMap` call via a thin RenderContext field or a closure — whichever requires the smaller diff against the current call site (decide during implementation; both are acceptable).

The deciding constraint: do **not** widen `RenderContext` with iso-only fields permanently. If a closure works, use a closure. If a context field is unavoidable, mark it optional (`isoAtlas?: IsoAtlas`) and document it as iso-only.

### Wiring blob-autotiler

New helper in `src/map/blob-autotiler.ts`:

```ts
export function blobVariantAt(map: GameMap, tx: number, ty: number): number;
```

Implementation: read tile's terrain group from `TERRAIN_GROUPS` (already in the file; change to `export const`), build the 8-bit neighbor mask using the corner-cleanup rule already in the file, look up `BLOB_INDEX_MAP[mask]`.

`iso-terrain.ts:28` changes from `atlas.getTerrain(tileType, 0)` to `atlas.getTerrain(tileType, blobVariantAt(map, tx, ty))`. That's the integration. Top-down callers of equivalent logic (if any — verify during PR 2) migrate to the same helper to avoid duplication.

## Fallback behavior

Two independent levels, both supported by `iso-terrain.ts` as it stands today:

1. **Atlas-level**. If `selectRenderer()` returns `atlas: null` (load threw, network down, PR 2 reverted), every `getTerrain` call returns `null` and `iso-terrain.ts` falls through to the existing diamond `TILE_COLORS` path per tile.
2. **Per-type**. If `grass-blob47.png` 404s but `dirt-blob47.png` loads, `getTerrain('grass', _) → null` (grass renders as diamonds) while `getTerrain('dirt', _) → sprite` (dirt renders as art). This lets future visual revisions ship one terrain type at a time.

Failure surfaces as a single `console.warn('[iso-atlas] failed to load grass-blob47.png')` per missing sheet. No throw, no game-blocking error.

## Testing strategy

| Module | Tests | Coverage |
|---|---|---|
| `blob-composer.ts` | ~12 | Synthetic 5×3 primitive sheet (each cell flat-filled with a distinct color). Compose to 48-cell atlas. Assert: (a) blob index 0 (isolated tile) reads its 4 quadrants from the right primitive; (b) blob index for "X surrounded by X" reads all 4 quadrants from the center primitive; (c) all 47 cells render some non-transparent pixel; (d) cell at unused slot 47 is transparent; (e) the corner-quadrant lookup table is symmetric under reflection (NW-corner case ↔ NE-corner case mirror correctly) |
| `iso-atlas-loader.ts` | ~5 | Mock `Image` loads. 6 sheets load → atlas returns correct slice coords. One 404 → that type returns null, others still work. All 6 404 → atlas where every `getTerrain` returns null (still a valid `IsoAtlas`). Single `console.warn` per missing sheet, none for successful loads. |
| `iso-terrain.ts` integration | ~3 | RenderContext with a 3×3 grass island in dirt → `getTerrain` called with correct variant indices for center, edge, and corner tiles. `drawImage` call count = 9. With null atlas, falls back to diamond `fill()` 9 times. |
| `blob-autotiler.ts` | refactor only — existing test count preserved | Exported `blobVariantAt(map, tx, ty)` covered by existing autotiler test fixtures rewired through the new helper. |

Pixel-perfect terrain output is **not** tested — too brittle, same stance as iso renderer design spec line 186.

**Manual smoke per PR 2.** Flip the flag, walk the camera over a mixed-terrain area, confirm tiles butt up against each other without visible seams. Document the result in the PR description.

## Module boundaries

```
src/render/iso/
  blob-composer.ts        ← pure; called by scripts/ + tests, not by runtime
  iso-atlas-loader.ts     ← runtime: parallel Image loads, per-type fallback
  iso-atlas.ts            ← unchanged interface; createNullAtlas() still exists for tests
  iso-terrain.ts          ← consumes blobVariantAt(); per-tile fallback already works
  iso-renderer.ts         ← unchanged
  select-renderer.ts      ← returns {renderMap, atlas}

src/map/
  blob-autotiler.ts       ← exports TERRAIN_GROUPS, exports blobVariantAt()

scripts/
  gen-iso-terrain.ts      ← Node, uses blob-composer + @napi-rs/canvas

public/sprites/iso/terrain/
  grass-blob47.png        ← committed, 768×384
  dirt-blob47.png
  water-blob47.png
  sand-blob47.png
  stone-blob47.png
  rocky-blob47.png

var/iso-terrain-cache/    ← gitignored, disk cache for PixelLab responses
```

## Risks & known gaps

- **PixelLab may not consistently produce a coherent 5×3 sheet from a single prompt.** Mitigation: the prompt template is explicit about layout; if PixelLab can't lay out a 5×3 grid reliably, fall back to 15 separate calls per type (90 total) — recoverable from within the script, no architecture change required. The 6-call/$0.15 vs 90-call/$2 cost delta is small enough that we can absorb either.
- **PixelLab view-angle field name unknown until call-site.** Confirmed at the script's first PixelLab call. If the call fails with an "unknown field" error, the script logs and exits; fix the field name and re-run.
- **node-canvas / `@napi-rs/canvas` PNG encoding determinism.** A future version bump could change byte output even with identical pixels. Mitigation: commit a `.png-fingerprint` (sha256 of pixel data, not file bytes) alongside each PNG so we detect drift. Add to the script.
- **Disk cache + git interaction.** `var/` is gitignored; reviewers running the script will pull from PixelLab on first run unless we ship the cache. Acceptable: PR-time review doesn't require re-running the script, only the PNGs are reviewed.

## Rollout

PR 2 single PR. Lands behind the existing `localStorage.smallgods.render.mode='iso'` dev flag. No user-visible change until PR 7 flips the default (separate decision per the iso renderer design spec).

Sequencing within PR 2:
1. Composer module + unit tests (TDD).
2. Author-time script + first PixelLab call + first committed PNG (e.g. grass).
3. Atlas loader + integration test (with that one PNG).
4. Blob-autotiler refactor + iso-terrain wire-up.
5. Generate + commit remaining 5 PNGs.
6. Manual smoke. PR description includes a before/after screenshot.

Each step keeps tests green and `npm run build` clean (modulo the known pre-existing `tests/e2e/map-generation.spec.ts` errors).

## Open questions deferred to plan

- Whether `RenderContext` gets an `isoAtlas?: IsoAtlas` field or `select-renderer.ts` closure-captures the atlas. Both work; pick whichever yields the smaller diff in PR 2's implementation phase.
- Top-down renderer's current handling of blob-autotiling (whether it calls equivalent logic that should DRY through `blobVariantAt()`). Decide during refactor in step 4.
- Exact wording of the 6 per-type PixelLab prompts. Authored during the script's first run.
