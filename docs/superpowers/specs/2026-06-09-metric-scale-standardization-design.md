# Metric Scale Standardization — Design

**Date:** 2026-06-09
**Status:** Approved (brainstorm complete)
**Branch:** `feat/metric-scale-standardization`

## Goal

Replace the scattered, arbitrary "relative-scale" numbers that size every visible
entity class (buildings, NPCs, vegetation, boulders, terrain, walls) with one
**metric source of truth**: author every real-world dimension in **metres**, convert
to pixels through a single `PX_PER_METRE`, and **snap to integer pixels at the end**
so everything still obeys the 1:1 pixel-perfect rendering rule. The result is a
**metrically truthful world** — a 1.7 m human stands at correct relative size beside a
6 m yurt, a 2.7 m storey, a 1.2 m boulder, and a 15 m oak — and an authoring layer a
human or LLM agent can sanity-check ("is 0.85 right for a door?" → "no, a door is 2.0 m").

## Decisions (locked during brainstorm)

1. **Truthful look, not re-anchor.** We calibrate one `PX_PER_METRE` so all classes
   share honest relative sizes. Some entities visibly change size (trees grow; storeys
   shrink). This is intentional — it is the whole point of metric.
2. **Master anchor: 1 ground tile = 2 m.** A 1.7 m human reads at 0.85 tile (smaller
   than a tile ✓); a 3×3 yurt/cottage = 6 m (real yurts 4–8 m ✓).
3. **Architecture: one metric source of truth** (`scale-contract.ts` rewritten in metres,
   pixels derived). No competing typing layer — `Metres` is a plain `number` authored in
   the metric module; the discipline lives in "author in the table, derive pixels."
4. **Everything snaps to integer pixels** (`snapPx = Math.round`). Billboard art uses
   **integer source-scale classes only** (1×, 2×, …) — never fractional — to stay crisp.

## Master constants

```ts
export const METRES_PER_TILE = 2;                                  // master anchor
export const PX_PER_METRE     = HEIGHT_UNIT_PX / METRES_PER_TILE;  // 64 / 2 = 32
```

`HEIGHT_UNIT_PX = ISO_TILE_H = 64` already means "vertical screen px for one tile-depth
of world height." Since one tile-depth = `METRES_PER_TILE` = 2 m, `PX_PER_METRE = 32`.
This is the figure to **verify empirically against a render** (per the project's
"verify geometry claims with a real render" rule) before locking; the architecture holds
for any value.

### Derived calibration (at PX_PER_METRE = 32)

| Thing            | Metres | → px (`mToPx`) | → cube-units (`mToTiles`) |
|------------------|--------|----------------|---------------------------|
| Human (visible)  | 1.7    | 54  (was 46)   | —                         |
| Door height      | 2.0    | 64             | 1.00 (was 0.85)           |
| Door width       | 0.9    | 29             | 0.45 (was 0.40)           |
| Storey           | 2.7    | 86             | 1.35 (was STOREY = 2.1)   |
| Boulder          | 1.2    | 38             | —                         |
| Shrub            | 1.5    | 48             | —                         |
| Fern / groundcover | 0.5  | 16             | —                         |
| Oak              | 15     | 480            | —                         |
| Pine             | 18     | 576            | —                         |

> "cube-unit" = the blueprint/manifold geometry's height unit, where **1 cube-unit = 1
> tile = 2 m**. The geometry footprint `w`/`h` are already in tiles, so heights must use
> the same unit. Today `STOREY = 2.1` cube-units = **4.2 m/storey** (too tall) — the
> headline inconsistency this refactor fixes.

## Architecture

### Unit 1 — `src/render/scale-contract.ts` (the metric core)

Rewritten as the single source of truth. **Authored values are metres; pixels are derived.**

```ts
import { ISO_TILE_W, ISO_TILE_H } from './iso/iso-constants';

export const HEIGHT_UNIT_PX  = ISO_TILE_H;                          // 64 (kept)
export const METRES_PER_TILE = 2;
export const PX_PER_METRE     = HEIGHT_UNIT_PX / METRES_PER_TILE;   // 32

// Conversions
export const mToPx    = (m: number) => m * PX_PER_METRE;
export const mToTiles = (m: number) => m / METRES_PER_TILE;
export const snapPx   = (px: number) => Math.round(px);            // 1:1 rule

// Authored real-world dimensions (metres)
export const HUMAN_HEIGHT_M = 1.7;
export const DOOR_HEIGHT_M  = 2.0;
export const DOOR_WIDTH_M   = 0.9;
export const STOREY_M       = 2.7;

// One nature table — the place a human or LLM agent reads "how big is an oak"
export const NATURE_HEIGHT_M: Record<string, number> = {
  oak: 15, pine: 18, birch: 12, shrub: 1.5, fern: 0.5,
  boulder: 1.2, rock: 0.6, /* … extended to cover every vegetation/rock kind … */
};
export const DEFAULT_NATURE_HEIGHT_M = 1.0; // fallback for unlisted kinds (logged once)

// Derived px / cube-units (kept for back-compat call sites)
export const HUMAN_PX      = snapPx(mToPx(HUMAN_HEIGHT_M));   // 54
export const DOOR_HEIGHT_TILES = mToTiles(DOOR_HEIGHT_M);    // 1.0
export const DOOR_WIDTH_TILES  = mToTiles(DOOR_WIDTH_M);     // 0.45
export const STOREY_TILES      = mToTiles(STOREY_M);         // 1.35

export { ISO_TILE_W, ISO_TILE_H };
```

**Deleted:** `HUMAN_HEIGHT_UNITS`, `DOOR_HEIGHT_UNITS` (relative-scale constants). Every
caller repoints to the metric equivalent. `DOOR_WIDTH_TILES` keeps its name but is now
derived from `DOOR_WIDTH_M` (value changes 0.40 → 0.45).

### Unit 2 — Geometry cube-unit alignment

The blueprint/manifold geometry is pinned to "1 cube-unit = 1 tile = 2 m":

- `src/assetgen/geometry/building.ts`: `STOREY = STOREY_TILES` (1.35), imported from
  `scale-contract`. (Removes the magic `2.1`.)
- `src/blueprint/features/door.ts`: door height/width from `DOOR_HEIGHT_TILES` /
  `DOOR_WIDTH_TILES` (metric-derived).
- `src/blueprint/parts/body.ts`: round-body wall/dome already anchored to the door —
  re-express in terms of `DOOR_HEIGHT_TILES` (no behavioural change beyond the door
  value shift); stepped-body boxes use the new `STOREY`.
- `src/blueprint/parts/structural.ts`: linear/structural parts use the new `STOREY`.
- **Dead-param removal:** delete `heightPerLevel` from the body param schema and from
  `to-brief.ts`; building height = `levels × STOREY_M` (brief) / `levels × STOREY`
  (geometry). Migrate all 12 presets in `src/blueprint/presets/index.ts` to drop
  `heightPerLevel`. Where a preset used `heightPerLevel` to mean "this building is
  taller/shorter than a normal storey" (e.g. temple 1.5, dock 0.2, keep 0.7), express
  that as an explicit metric `storeyM` override on the part (new optional param, metres)
  so intent is preserved, not silently flattened.

### Unit 3 — Building generator at fixed metric scale

**Problem:** `src/assetgen/render/fit.ts` `computeFit(facets, size, fillFrac)` scales each
building to fill its sprite canvas. Two buildings with the same footprint but different
heights get *different* internal px-per-metre — vertically not metric-consistent.

**Fix:** add a **fixed-scale** projection path used for buildings: project at
`scale = PX_PER_METRE` worth of px per cube-unit (i.e. `HEIGHT_UNIT_PX` px per cube-unit
vertically, matching the iso tile horizontally), and size the output canvas to the
projected content bounds (tall buildings → taller sprites). `computeFit`/`fillFrac` is
retained only where a fit-to-box is genuinely wanted (if anywhere); buildings switch to
the fixed path. Placement in `iso-building.ts` is unchanged: the sprite is still blitted
native, bottom-anchored on the footprint's front tip — now its height is honest.

This is the **highest-risk unit**. It is gated by (a) the building golden-regression
snapshot test and (b) a preview render eyeballed before merge.

### Unit 4 — Billboards: NPC, vegetation, boulder

- `src/render/iso/iso-sprites.ts`:
  - `BILLBOARD_H_PX` derives from the metric core so the NPC billboard's visible body
    equals `HUMAN_PX` (calibrated against the LPC frame's transparent headroom).
  - `drawIsoVegetation`: replace `scale`/`canopyR`/integer-class heuristic with
    `targetPx = mToPx(NATURE_HEIGHT_M[kind] ?? DEFAULT_NATURE_HEIGHT_M)`, then choose the
    **nearest integer source-scale** `Math.max(1, Math.round(targetPx / SOURCE_PX))` for
    the billboard blit (stays pixel-crisp). The drawn-placeholder fallback (canopyR) is
    re-derived from the same `targetPx` so headless/test rendering stays proportional.
- `src/world/brushes/vegetation-placer.ts` and the brush callers
  (`forest`, `pine-forest`, `dense-forest`, `scrubland`, `quarry`, `hills`): the
  per-instance `scale` property becomes a small ± variety multiplier on the kind's metric
  height (e.g. 0.85–1.15), not an absolute size. Boulders (`quarry`) size from
  `NATURE_HEIGHT_M.boulder`.

**Known limitation (flagged, not hidden):** vegetation source art is 64px; a truthful
15 m oak (480px) is an ~8× integer upscale → blocky. This is the honest proportion. The
art re-authoring at true native sizes is the **period/style track** (the code already
notes "tree art will be re-authored at true sizes in a later pass"). We ship correct
*sizing* now; correct *art* later. A one-line `log()`/comment records the upscale factor
cap so the deficit is visible, never silently truncated.

### Unit 5 — Terrain, walls, tests

- **Terrain:** no pixel change — the iso tile is fixed 128×64. Add the `METRES_PER_TILE`
  label + a doc comment in `iso-constants.ts`/`scale-contract.ts` so the 2 m/tile fact is
  discoverable. (Top-down `TILE_SIZE = 32` is a separate legacy renderer; leave it, note it.)
- **Walls:** `src/render/iso/iso-barrier.ts` — barrier `run.height` is in cube-units
  (tiles); author wall heights via `mToTiles(...)`. `riseZ = run.height * HEIGHT_UNIT_PX`
  is already consistent (1 cube-unit → HEIGHT_UNIT_PX px = 2 m → 32 px/m ✓).
- **Tests:**
  - `tests/unit/scale-contract-metric.test.ts` — conversions (`mToPx(2)===64`,
    `mToTiles(2)===1`), calibration assertions (`HUMAN_PX===54`, `DOOR_HEIGHT_TILES===1`,
    `STOREY_TILES` ≈ 1.35), and that `PX_PER_METRE === 32`.
  - `tests/unit/no-relative-scale.test.ts` (guard) — the deleted relative constants
    (`HUMAN_HEIGHT_UNITS`, `DOOR_HEIGHT_UNITS`) are not reintroduced, and the five sizing
    paths import from `scale-contract` rather than hardcoding pixel literals for entity size.
  - Building golden-regression updated for the new heights (Unit 2 + 3).
  - Body/door/preset unit tests updated for the new cube-unit values.
  - Preview render (`scripts/assetgen-preview.ts`) + an in-game eyeball pass.

## Data flow

```
authored metres (scale-contract: HUMAN_HEIGHT_M, STOREY_M, NATURE_HEIGHT_M, …)
   │  mToTiles                                  │  mToPx
   ▼                                            ▼
geometry cube-units (blueprint → manifold)   billboard target px (NPC/veg/boulder)
   │  fixed-scale project (PX_PER_METRE)         │  nearest integer source-scale
   ▼                                            ▼
building sprite (content-sized canvas)       crisp native blit
   └──────────────► snapPx / integer scale ◄──────────────┘
                       1:1 pixel-perfect screen
```

## Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Fixed-scale building gen destabilizes the just-shipped pipeline | Most-isolated unit; golden-regression + preview eyeball gate; keep `computeFit` available |
| Truthful trees look huge/blocky | Expected & accepted (truthful look chosen); art fix deferred to period/style track; upscale logged |
| `PX_PER_METRE = 32` slightly off vs intent | Verify against a render before locking; single constant to tune |
| Preset intent lost when dropping `heightPerLevel` | Preserve as explicit metric `storeyM` override where it carried meaning |
| Wide blast radius (many call sites) | One source module; guard test; sequenced slices each independently green |

## Out of scope

- Re-authoring vegetation/building **art** at true native sizes (period/style track).
- Top-down legacy renderer pixel scale (`TILE_SIZE = 32`) beyond a clarifying note.
- Camera zoom ladder changes (already integer/`1-of-n`; unaffected).
- Period/style taxonomy and default-world recipe (the next track).
