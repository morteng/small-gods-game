# Pixel-Perfect 1:1 Asset Rendering — Design

**Date:** 2026-06-07
**Status:** Approved (architecture + both forks), pending spec review
**Depends on:** Phase 1 pixel-perfect transform (zoom ladder + origin snap), already shipped.

## Goal

Every iso-world asset renders **1:1 — one source art pixel = one screen pixel** at zoom 1
(the "1:1" button), and integer-scaled (2×, 3×) or uniformly downscaled (1/n) at the other
zoom rungs. All assets share **uniform pixel density** and sit aligned on the tile grid.

## Diagnosis — why it isn't 1:1 today

A sprite is 1:1 only when its **source pixel dimensions equal its on-screen draw size**. The
iso renderer instead sizes sprites from *tile geometry*, so the art gets rescaled:

| Asset | Source art | Drawn at | Result |
|---|---|---|---|
| NPCs | 64×64 | 64×64 | ✅ true 1:1 |
| Buildings | **128px** (no-bg gen cap) | footprint diamond `(w+h)·64` (256–512px) | ❌ stretched 2×–4× |
| Trees | 64×64 square | `~102×~154` (forced 1.5 aspect) | ❌ non-integer scale + distorted |
| Decorations | native | `0.7·ISO_TILE_W` = 90px | ❌ scaled |

Buildings are generated at the 128px `no_background` ceiling but shown at their true footprint
size, so a 3×3 cottage is a **3× upscale** and a 4×4 temple a **4×** — visibly coarse, with a
pixel density 3–4× chunkier than the (1:1) NPCs beside them. That density mismatch is the eye-sore.

## Architecture — WYSIWYG sprites

**One rule: the renderer never resizes a sprite. It blits at the art's natural pixel size**
(`img.naturalWidth/Height`), positioned grid-anchored. The global `ctx.scale(zoom)` (a Phase-1
ladder rung: integer in, 1/n out) supplies all scaling. Therefore *native size IS the zoom-1
display size*, and 1:1 is structural.

For that to look correct, **every asset is authored at its true on-grid pixel size**:

- **Buildings** → generate at the real footprint width `(w+h)·64` (+ rise height), not 128.
- **Trees / decorations** → blit at source native (no tile-fraction scaling).
- **NPCs** → already correct, unchanged.

### Decision 1 — cap building footprints at 3×3

PixelLab caps generation at **400px** and `no_background` is reliable only ≤128px. True-1:1
widths: 2×2→256, 3×2/2×3→320, 3×3→384 (all ≤400, OK), but 5×2→448 and 4×4→512 **exceed 400**.

→ **Cap every footprint at perimeter `w+h ≤ 6` (≤384px).** Concretely:
- `temple_small` 4×4 → **3×3**
- `castle_keep` 4×4 → **3×3**
- `longhouse` 5×2 → **4×2** (preserves elongation, `(4+2)·64 = 384`)

Every building is then ≤384px → generatable + 1:1. This is a data change in
`building-presets.ts`; footprints flow through collision/door/placement dynamically.

### Decision 2 — billboards: native-blit now, re-author art later

Switch trees/decorations to native-size blit immediately (free, truly 1:1). Existing tree art is
64×64, so trees shrink and may look squat until tree/prop art is regenerated at proper sizes in a
**later, separate pass** (out of scope here). To avoid tiny trees in the interim and keep clump
variety **while staying pixel-perfect**, trees may use an **integer scale class** (1× or 2× native,
chosen per-tile) — never a fractional scale.

## Components & changes

### 1. Renderer — `src/render/iso/iso-building.ts`
`drawIsoBuildingSprite`: drop the `drawW = diamondW` stretch. Blit at **native** size:
`drawW = natW`, `drawH = natH`, centred on the footprint's centre x, bottom edge at the south
(front) diamond tip. With native `== (w+h)·64`, the sprite fills its footprint exactly → 1:1.
(If a sprite is mis-sized, it visibly won't fit — an intentional signal, not a silent stretch.)

### 2. Renderer — `src/render/iso/iso-sprites.ts`
- `drawIsoArtBillboard` (decorations): blit at `img.naturalWidth/Height`, base anchored at tile
  centre. Drop the `0.7·ISO_TILE_W` scaling.
- `drawIsoVegetation` (tree-sheet branch): blit at `TREE_SPRITE_SRC` native (optionally ×2 for a
  large-size class), base anchored. Drop the `0.8·ISO_TILE_W·scale` + 1.5-aspect stretch.
- NPC path unchanged (already native 64×64).

### 3. Footprints — `src/world/building-presets.ts`
Apply the three footprint reductions from Decision 1.

### 4. Native size — `src/assetgen/view-registry.ts`
`isoNativeSize`: **remove the `ISO_MAX_PX = 128` clamp.** Native = exact silhouette box:
`width = (w+h)·ISO_TILE_W/2`, `height = (w+h)·ISO_TILE_H/2 + rise·ISO_TILE_H`. Keep the 16px snap
(a no-op for these multiples). With the 3×3 cap the max is 384×(≤~400), within PixelLab's limit.

### 5. Generation pipeline — `scripts/gen-buildings.ts`
For each preset, request at the (now true-size) `isoNativeSize`. Since `no_background` fails >128px:
1. Generate **opaque** (`no_background: false`) at true size via pixflux (text-only, broad LPC
   palette — unchanged otherwise).
2. **Remove-background pass:** POST the result to PixelLab `remove-background` → transparent cutout.
3. Write the cutout to the probe dir + seed sidecar. Reseed via `seed-base-library.mjs` (paid, user-run).

Exact `remove-background` request/response shape to be confirmed against the live OpenAPI during
implementation (endpoint is listed in the API; verify field names before wiring).

### 6. Pixel-perfect invariant (carried from Phase 1)
Zoom is a ladder rung (`{1,2,3,4}` ∪ `{1/2…1/20}`); the render origin is snapped to a whole CSS
pixel. Native-size blits therefore land on integer device pixels at every rung. The "1:1" button
sets zoom = 1 → P = 1 → exact 1:1.

## Testing

- `iso-building.test.ts`: assert the building sprite is blitted at the image's natural size (not the
  footprint diamond width); centred-x + south-anchored position.
- `iso-sprites.test.ts`: assert decoration/tree blits use the source native size (no tile-fraction
  scaling); base anchored at tile centre.
- `view-registry.test.ts`: `isoNativeSize` returns the exact `(w+h)·64` width for capped footprints,
  no 128 clamp; longest axis ≤400.
- `building-presets` / collision / door tests: update any that hard-code the old 4×4 / 5×2 footprints.
- Existing pixflux-compiler / pixellab tests: extend for the opaque-gen + remove-background flow.

## Out of scope (explicit)
- Re-authoring tree + decoration art at proper native sizes (a later pass; Decision 2 defers it).
- Top-down renderer (iso is the focus; top-down may become minimap-only).
- Footprint changes beyond the three needed for the ≤384px cap.

## Sequencing
1. Renderer native-blit for **billboards** (trees/deco) + tests — free, immediate 1:1 for those.
2. Footprint cap + `isoNativeSize` un-cap + building renderer native-blit + tests.
3. Gen pipeline (true-size + remove-background) — then the user runs the paid regen + reseed.
