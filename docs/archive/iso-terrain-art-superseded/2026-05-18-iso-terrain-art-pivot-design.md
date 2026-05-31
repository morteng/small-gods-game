# Iso Terrain Art — Pivot (create-tileset) Design Spec

> **STALE (2026-05-21):** Superseded. The iso renderer now uses plain
> per-terrain colored diamonds; the Wang/blob-47 autotiling described below
> was ripped out. Kept for history only.

**Status:** Design (2026-05-18) — pivot from the same-day superseded design
**Author:** brainstormed via Claude + Morten after PR-2-time PixelLab API discovery
**Supersedes:** [Iso Terrain Art design (superseded)](2026-05-18-iso-terrain-art-design.md)
**Related:** [Iso renderer design](2026-05-18-iso-renderer-design.md), [PixelLab API surface notes](../../../../.claude/projects/-Users-Morten-mcpui-small-gods-game/memory/hosted-image-api-research-2026-05.md), [PixelLab API depth feedback](../../../../.claude/projects/-Users-Morten-mcpui-small-gods-game/memory/feedback_pixellab_api_depth.md)

## Why this pivot

The original spec assumed PixelLab's pixflux endpoint could be coerced into producing dimetric iso primitives via a custom `view` value, then a procedural composer would assemble 47 blob variants from a 5×3 primitive sheet. First call against the live API exposed both assumptions as wrong:

1. **`image_size` caps at 400×400 per dim** (subscription-tiered: 200/320/400). Our 640×192 sheet → HTTP 422.
2. **`view` is a strict enum:** `'side'`, `'low top-down'`, `'high top-down'`. **No iso, no dimetric, no oblique.**

Deeper docs reading then revealed:

3. **`create-tileset` natively generates Wang/47-blob terrain transitions** via inner/outer descriptions (e.g. inner=`grass` + outer=`dirt`). Top-down or sidescroller mode. This is the primitive our composer was hand-rolling.
4. **`create-isometric-tile`** exists but is capped at 32×32 or 16×16 — useless for our 128×64 target.

The pivot replaces the composer + 5×3 primitive sheet machinery with a single `create-tileset` call per terrain type plus a top-down → iso warp post-process.

## Summary

Use PixelLab's `create-tileset` endpoint (top-down Wang format) to generate a 47-tile transition tileset for each of 6 base terrain groups (water, sand, dirt, grass, stone, rocky). For each terrain, the call describes inner = "X" + outer = a deliberately neutral adjacent terrain (e.g. for grass, outer = "dirt"). The returned tileset PNG is in top-down orientation. The script applies a deterministic iso warp (45° rotation + 2:1 vertical squash) per cell to produce the 128×64 iso atlas at `public/sprites/iso/terrain/<type>-blob47.png`. The atlas-loader, iso-renderer factory, and `select-renderer` wiring already shipped in Tasks 4–8 of the original plan stay unchanged — they only care that the PNGs exist at the right path with the right cell layout.

## Goals (unchanged from superseded spec)

- Iso terrain renders as real pixel art for all 6 base terrain groups
- One API call per terrain type (now via `create-tileset` instead of pixflux)
- Per-type fallback to `TILE_COLORS` diamond on missing/failed PNG (already working)
- Top-down renderer, sim, snapshot/timeline untouched

## What's kept from the superseded plan

All work from Tasks 4–8 is `create-tileset`-agnostic and stays:

- `src/render/iso/iso-atlas-loader.ts` — `loadIsoTerrainAtlas()` returning `IsoAtlas` (5 tests)
- `src/render/iso/iso-terrain.ts` modified to consume `rc.blobMap[ty][tx].blobIndex` (3 tests)
- `src/render/iso/iso-renderer.ts` refactored to `createIsoRenderMap(atlas)` factory (2 tests)
- `src/render/select-renderer.ts` loads the atlas in iso mode
- `package.json` + `.gitignore` (devDeps + `gen:iso-terrain` script + `var/`)

## What's dropped

- `src/render/iso/blob-composer.ts` — module deleted
- `tests/unit/blob-composer.test.ts` — 15 tests deleted
- `BLOB_INDEX_MAP_FOR_TEST` export in `src/map/blob-autotiler.ts` — the composer was its only consumer; can be removed (or kept as a low-cost diagnostic export — small judgment call at PR time)

The script's structure stays (disk cache, `--type` flag, idempotency) but its `fetchPrimitiveSheet` → `bakeOne` flow is reworked.

## Architectural decisions (locked during this pivot brainstorm)

| Decision | Choice |
|---|---|
| PixelLab endpoint | `POST /v2/create-tileset` (Wang format) |
| One call per terrain | Yes — `inner = "<type>"`, `outer = <deliberately chosen neighbor>` |
| Output orientation from PixelLab | Top-down |
| Iso conversion | Post-process per cell: 45° rotate + 2:1 vertical squash via node-canvas |
| Per-cell input size | Determined by PixelLab's tileset response layout (likely 32 × 32 or 64 × 64 per cell — confirm at call-site) |
| Output cell size | 128 × 64 (unchanged — the iso atlas-loader expects this) |
| Wang ↔ blob47 index mapping | `create-tileset`'s Wang layout maps deterministically to blob index 0..46 — derive the mapping at the script level so the atlas matches what `computeBlobMap` produces at runtime |
| Composer module | Deleted |
| Disk cache | Same shape as before (`var/iso-terrain-cache/<sha>.png`) |
| API key handling | Same — env var `PIXELLAB_API_KEY` |

## API contract (script ↔ PixelLab)

Per-type request body (subject to confirmation at first call; values bolded are speculative until verified against the live API):

```json
{
  "inner": "grass",
  "outer": "dirt",
  "tile_layout": "wang",
  "tile_size": { "width": 64, "height": 64 },
  "outline": "single color black outline",
  "shading": "basic shading",
  "detail": "medium detail",
  "color_image": { "type": "base64", "base64": "<palette>", "format": "png" },
  "seed": 1001
}
```

Response shape (per docs/v2): tileset PNG returned as `{ image: { base64 } }` like other endpoints. The PNG contains the 47 Wang transition cells in a known grid layout (the exact ordering of cells in the response image is the per-call discovery this PR has to make — confirm against PixelLab's tileset response by inspection of the first generated PNG).

If the response layout doesn't match the runtime's blob47 index expectations, the script's per-cell warp loop applies a permutation map (Wang → blob47-index) before writing to the atlas. This permutation table is built once during PR 2 and committed alongside the script.

## Top-down → iso warp algorithm

For each of the 47 input cells (Wang-ordered, each input cell some size like `64×64`):

```
1. Lift to a square Canvas of side = input_cell_size
2. Rotate canvas by 45° around its center
3. Scale vertical axis by 0.5 (to produce the 2:1 dimetric squash)
4. Crop / resample to a 128×64 cell
5. Draw into the output atlas at position (col, row) for the blob index
   the Wang cell corresponds to:
     col = blobIndex % 6
     row = floor(blobIndex / 6)
```

Implementation: node-canvas via `@napi-rs/canvas`. The four-step transform is ~10 lines per cell.

The output atlas dimensions stay 768 × 512 (6 cols × 8 rows of 128 × 64). The atlas-loader's per-cell math `{sx, sy} = ((variant % 6) * 128, floor(variant / 6) * 64)` is unchanged.

## Wang-to-blob47-index mapping

PixelLab's Wang format and our autotiler's `BLOB_INDEX_MAP` use different bit conventions. The script discovers and commits a single permutation table:

```ts
// scripts/wang-to-blob47.ts (or inline in gen-iso-terrain.ts)
const WANG_TO_BLOB47: number[] = [/* 47 entries — populated after inspecting create-tileset response */];
```

This table is built by:
1. Generating a single tileset for any terrain (e.g. `grass`/`dirt`) once
2. Manually inspecting the response image to identify which response-cell-index corresponds to which 47-blob topology
3. Writing the permutation table into the script
4. Verifying by rendering the resulting atlas in the iso renderer and confirming visible tiles align with their neighbor topology

This is a one-time per-PR human-in-the-loop step. Once locked, the table is reused for all 6 terrain types.

## Per-terrain "outer" choices

For each inner terrain, the `outer` is chosen to give a visually coherent transition. Final values can be tuned per-output during PR 2:

| inner | outer (initial) | rationale |
|---|---|---|
| `grass` | `dirt` | grass → bare earth at edges |
| `dirt` | `grass` | reciprocal of above |
| `water` | `sand` | water meets beach |
| `sand` | `dirt` | sand into open ground |
| `stone` | `dirt` | stone floor with earth at edges |
| `rocky` | `grass` | rugged stone amid grass |

PixelLab's `create-tileset` understands these as natural-language hints, not enum values. Adjust at PR time if outputs look wrong.

## Fallback behavior (unchanged)

Same per-type fallback as before — missing PNG → `getTerrain` returns null → `iso-terrain.ts` falls through to `TILE_COLORS` diamond. The atlas-loader tests (5 passing) cover this.

## Testing strategy

| Module | Coverage |
|---|---|
| `iso-atlas-loader.ts` | unchanged — 5 tests, no change |
| `iso-terrain.ts` | unchanged — 3 tests, no change |
| `iso-renderer.ts` | unchanged — 2 tests, no change |
| `scripts/gen-iso-terrain.ts` | manual smoke per terrain at PR time; no unit tests (script is build-side, runs once per art iteration) |
| `iso-warp` post-process | optional ~3 tests with synthetic input cells, verifying output is 128×64 + has non-transparent pixels; keep this small since the warp is mostly geometric and visually verified |

**Manual smoke per PR 2 (pivot):** flip iso flag, walk a mixed-terrain area, confirm tiles butt up correctly. Same as before.

## Risks & known gaps

- **`create-tileset` requires Tier 1 subscription** per the docs. If the user's PixelLab API key is on the free tier, this endpoint returns HTTP 403 (or similar). Mitigation: the script logs a clear error and the dev can upgrade or revert to a fallback approach.
- **Wang-cell layout in the response isn't documented in detail.** First call inspection required; ~30 minutes of "look at the PNG, write down which cell is which" work. Captured in the `WANG_TO_BLOB47` permutation table.
- **PixelLab's `create-tileset` output is top-down.** The 45°+squash warp gives "iso-ish" results but isn't true dimetric — corner pixels stretch slightly. Visual quality has to be smoke-checked per terrain. If unacceptable, the pivot-pivot is to use the (separately-capped-at-32×32) `create-isometric-tile` endpoint and upscale, accepting blockier art.
- **Some terrain transitions might be ambiguous.** "rocky → grass" might produce odd-looking transitions if PixelLab interprets them as forest. Per-call prompt iteration handles this.

## Rollout

Single PR — same branch (`feat/iso-terrain-art`). Sequence:

1. Revert composer module + tests
2. Rewrite `scripts/gen-iso-terrain.ts` to use `create-tileset`
3. Add iso-warp post-process module
4. Generate one terrain (grass) and inspect the response → build the Wang → blob47 permutation table
5. Generate remaining 5 terrains
6. Manual smoke
7. PR description

## Out of scope (unchanged from superseded spec)

Iso buildings, characters, trees, decorations — those are PRs 3/4/5 in the iso renderer track. Iso road group still routes through Kenney directional sprites. Iso overlays (past-veil, sigils) are PR 6.

## Open questions deferred to plan

- Exact Wang-cell layout in `create-tileset` responses (response image dimensions, cells per row/col). Confirmed by inspection of first generated PNG.
- Whether to delete `BLOB_INDEX_MAP_FOR_TEST` export from `src/map/blob-autotiler.ts` or keep as diagnostic. Trivial; decide at PR time.
- Whether the warp produces acceptable visual quality. Smoke-verified at PR 2 manual smoke step.
